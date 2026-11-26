// Times indexing a real project twice. Bundle with esbuild, then: node <out>.cjs <project folder> <cache folder>
// Indexes a real project's Markdown with the real finder and Ollama, twice, and times both (read-only).
import fs from 'node:fs';
import path from 'node:path';
import { ProjectIndex, VectorCache, EMBED_MODEL } from '../../electron/ai/finder.ts';
import { ollamaEmbed } from '../../electron/ai/otherProviders.ts';

const root = process.argv[2];
const cacheDir = process.argv[3];
const skip = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.expo']);
const docs: any[] = [];
(function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!skip.has(e.name)) walk(path.join(dir, e.name));
    } else if (/\.mdx?$/i.test(e.name)) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      docs.push({ id: rel, path: rel, title: e.name, body: fs.readFileSync(full, 'utf-8') });
    }
  }
})(root);
const chars = docs.reduce((n, d) => n + d.body.length, 0);
console.log(`${docs.length} docs, ${(chars / 1e6).toFixed(1)}M chars`);
const embed = (inputs: string[]) => ollamaEmbed('http://localhost:11434', `${EMBED_MODEL}:latest`, inputs);
(async () => {
  for (const run of [1, 2]) {
    const t = Date.now();
    const idx = new ProjectIndex(docs);
    let last = 0;
    await idx.embedAll(`${EMBED_MODEL}:latest`, embed, new VectorCache(cacheDir), (p) => {
      if (Date.now() - last > 15000) {
        last = Date.now();
        console.log(`  ${p.done}/${p.total}`);
      }
    });
    console.log(`run ${run}: ${((Date.now() - t) / 1000).toFixed(1)}s`);
    if (run === 2) {
      const q = Date.now();
      const hits = await idx.search('how do I write a skill that deploys to production', 5, embed);
      console.log(`search ${Date.now() - q}ms:`, hits.map((h) => `${h.doc.path} ${h.score.toFixed(3)}`).join(' | '));
    }
  }
  let size = 0;
  (function du(d: string) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? du(path.join(d, e.name)) : (size += fs.statSync(path.join(d, e.name)).size);
  })(cacheDir);
  console.log(`cache ${(size / 1e6).toFixed(1)} MB`);
})();
