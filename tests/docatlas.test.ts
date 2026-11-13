import assert from 'node:assert';
import test from 'node:test';
import { MarkdownService } from '../src/services/markdown.ts';
import { inspectProjectStack, buildUpgradeGuidance } from '../src/services/stackInspector.ts';
import { auditProjectDocumentation } from '../src/services/docHealthAuditor.ts';
import {
  relativeLinkPath,
  applyDriftFixes,
  deprecateInPlace,
  restoreActive,
  adoptIntoReadme,
  rewriteRelativeLinksForMove,
  archivePathFor,
  restorePathFor,
} from '../src/services/docRemediation.ts';
import type { MarkdownFile, ProjectWorkspace } from '../src/types/document.ts';

const NOW = Date.UTC(2026, 10, 13);

function makeDoc(path: string, content: string, lastModifiedMs = NOW): MarkdownFile {
  const parsed = MarkdownService.parse(content, path);
  return {
    id: path,
    path,
    name: path.split('/').pop() || path,
    content,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    wordCount: parsed.wordCount,
    tasks: parsed.tasks,
    lastModifiedMs,
  };
}

function ws(files: MarkdownFile[], configFiles: Record<string, string> = {}): ProjectWorkspace {
  return {
    name: 'demo',
    rootPath: '/tmp/demo',
    isLocalFolder: true,
    tree: { id: 'root', name: 'demo', path: '', isFolder: true, children: [] },
    files,
    configFiles,
  };
}

const LONG =
  'This document explains the platform setup in plenty of words so that it is never considered a stub by the auditor at all.';

test('Auditor: scoped submodule READMEs get the distinct module-doc status', () => {
  const report = auditProjectDocumentation(
    ws([
      makeDoc('README.md', `# Root\n\n${LONG}`),
      makeDoc('packages/auth/README.md', '# Auth module\n\nHandles OAuth2 PKCE tokens, keystore encryption and refresh hooks for mobile clients.'),
    ]),
    inspectProjectStack(ws([])),
    NOW
  );
  const auth = report.inventory.find((i) => i.path === 'packages/auth/README.md')!;
  assert.strictEqual(auth.status, 'module-doc');
  assert.strictEqual(auth.isScopedModuleDoc, true);
  assert.strictEqual(report.counts['module-doc'], 1);
});

test('Auditor: _archive/ paths and the in-place deprecation banner are deprecated', () => {
  const report = auditProjectDocumentation(
    ws([
      makeDoc('README.md', `# Root\n\n${LONG}`),
      makeDoc('_archive/guide.md', `# Guide\n\n${LONG}`),
      makeDoc('docs/setup.md', `> [!WARNING] **Deprecated:** Superseded by [README](../README.md).\n\n# Setup\n\n${LONG}`),
    ]),
    inspectProjectStack(ws([])),
    NOW
  );
  assert.strictEqual(report.inventory.find((i) => i.path === '_archive/guide.md')!.status, 'deprecated');
  assert.strictEqual(report.inventory.find((i) => i.path === 'docs/setup.md')!.status, 'deprecated');
});

test('Auditor: explicit copy files outside canonical topics are duplicates of their original', () => {
  const report = auditProjectDocumentation(
    ws([
      makeDoc('README.md', `# Root\n\nSee [setup](docs/setup.md).\n\n${LONG}`),
      makeDoc('docs/setup.md', `# Setup\n\n${LONG}`),
      makeDoc('docs/setup-copy.md', `# Setup\n\n${LONG}`),
    ]),
    inspectProjectStack(ws([])),
    NOW
  );
  const copy = report.inventory.find((i) => i.path === 'docs/setup-copy.md')!;
  assert.strictEqual(copy.status, 'duplicate');
  assert.strictEqual(copy.duplicateOf, 'docs/setup.md');
});

test('Auditor: links inside fenced code are ignored; encoded and angle-bracket links resolve', () => {
  const report = auditProjectDocumentation(
    ws([
      makeDoc(
        'README.md',
        `# Root\n\n${LONG}\n\n\`\`\`md\n[example](docs/not-real.md)\n\`\`\`\n\n[Guide](docs/My%20Guide.md) and [Other](<docs/Other Doc.md>)`
      ),
      makeDoc('docs/My Guide.md', `# Guide\n\n${LONG}`),
      makeDoc('docs/Other Doc.md', `# Other\n\n${LONG}`),
    ]),
    inspectProjectStack(ws([])),
    NOW
  );
  const readme = report.inventory.find((i) => i.path === 'README.md')!;
  assert.deepStrictEqual(readme.brokenLinks, []);
  assert.strictEqual(report.inventory.find((i) => i.path === 'docs/My Guide.md')!.incomingLinksCount, 1);
  assert.strictEqual(report.inventory.find((i) => i.path === 'docs/Other Doc.md')!.incomingLinksCount, 1);
});

test('Auditor: database ports are never reported as dev-server port drift', () => {
  const stack = inspectProjectStack(
    ws([], { 'package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^6.0.0' } }) })
  );
  const report = auditProjectDocumentation(
    ws([makeDoc('README.md', `# Root\n\n${LONG}\n\nPostgres runs on localhost:5432 and the app on localhost:5173.`)]),
    stack,
    NOW
  );
  const readme = report.inventory.find((i) => i.path === 'README.md')!;
  assert.ok(!readme.issues.some((i) => i.includes('Port drift')));
  assert.strictEqual(readme.status, 'canonical');
});

test('Remediation: applyDriftFixes only rewrites drifted dev-server ports and SDK refs', () => {
  const body = 'App: http://localhost:3000\nDB: localhost:5432\nSupabase: localhost:54321\nUses Expo SDK 52.';
  const { body: fixed, changes } = applyDriftFixes(body, {
    frameworks: [],
    configFilesFound: [],
    scripts: {},
    dependencies: [],
    localPort: 5173,
    expoSdkVersion: '54.0.0',
  });
  assert.ok(fixed.includes('localhost:5173'));
  assert.ok(fixed.includes('localhost:5432'));
  assert.ok(fixed.includes('localhost:54321'));
  assert.ok(fixed.includes('Expo SDK 54'));
  assert.strictEqual(changes.length, 2);
});

test('Remediation: relative links are computed from the linking file directory', () => {
  assert.strictEqual(relativeLinkPath('docs/a.md', 'README.md'), '../README.md');
  assert.strictEqual(relativeLinkPath('README.md', 'docs/a b.md'), 'docs/a%20b.md');
  assert.strictEqual(relativeLinkPath('docs/x/y.md', 'docs/z.md'), '../z.md');
  assert.strictEqual(relativeLinkPath('docs/a.md', 'docs/b.md'), 'b.md');
});

test('Remediation: deprecate in place writes a relative banner and restore removes it', () => {
  const file = makeDoc('docs/old.md', '---\ntitle: "Old"\nstatus: "Active"\n---\n\n# Old\n\nBody text.');
  const dep = deprecateInPlace(file, 'README.md', '2026-11-13');
  assert.strictEqual(dep.frontmatter.status, 'Archived');
  assert.ok(dep.body.startsWith('> [!WARNING] **Deprecated:** Superseded by [README.md](../README.md).'));
  const again = deprecateInPlace({ ...file, frontmatter: dep.frontmatter, body: dep.body }, 'README.md', '2026-11-13');
  assert.strictEqual(again.body.match(/Deprecated:/g)!.length, 1);
  const restored = restoreActive({ ...file, frontmatter: dep.frontmatter, body: dep.body }, '2026-11-13');
  assert.strictEqual(restored.frontmatter.status, 'Active');
  assert.ok(!restored.body.includes('Deprecated'));
  assert.ok(restored.body.startsWith('# Old'));
});

test('Remediation: adoptIntoReadme appends under ## Documentation with a readme-relative link', () => {
  const readme = makeDoc('README.md', '# Demo\n\nIntro.\n\n## Documentation\n\n- [A](docs/a.md)\n\n## License\n\nMIT');
  const next = adoptIntoReadme(readme, 'notes/scratch pad.md', 'Scratch Pad')!;
  assert.ok(next.includes('- [A](docs/a.md)\n- [Scratch Pad](notes/scratch%20pad.md)\n'));
  assert.ok(next.indexOf('Scratch Pad') < next.indexOf('## License'));
  assert.strictEqual(adoptIntoReadme(readme, 'docs/a.md', 'A'), null);
  const bare = makeDoc('README.md', '# Demo\n\nIntro.');
  assert.ok(adoptIntoReadme(bare, 'todo.md', 'Todo')!.endsWith('## Documentation\n\n- [Todo](todo.md)\n'));
});

test('Remediation: moving a file rewrites its outbound relative links', () => {
  const body = 'See [arch](ARCHITECTURE.md), [web](https://x.dev/a.md) and [img](./img/x.png).';
  const moved = rewriteRelativeLinksForMove(body, 'docs/guide.md', '_archive/docs/guide.md');
  assert.ok(moved.includes('[arch](../../docs/ARCHITECTURE.md)'));
  assert.ok(moved.includes('[web](https://x.dev/a.md)'));
  assert.ok(moved.includes('[img](../../docs/img/x.png)'));
  assert.strictEqual(archivePathFor('docs/guide.md'), '_archive/docs/guide.md');
  assert.strictEqual(restorePathFor('_archive/docs/guide.md'), 'docs/guide.md');
  assert.strictEqual(restorePathFor('docs/guide.md'), null);
});

test('StackInspector: reads vite.config port, pyproject deps and gives pip upgrade commands', () => {
  const stack = inspectProjectStack(
    ws([], {
      'package.json': JSON.stringify({ scripts: { dev: 'vite' }, devDependencies: { vite: '^6.0.0' } }),
      'vite.config.ts': "export default defineConfig({ server: { port: 4321 } })",
      'pyproject.toml': '[tool.poetry.dependencies]\nfastapi = "^0.110.0"\n',
    })
  );
  assert.strictEqual(stack.localPort, 4321);
  const fastapi = stack.dependencies.find((d) => d.name === 'fastapi')!;
  assert.ok(fastapi);
  assert.strictEqual(fastapi.currentVersion, '0.110.0');
  const guidance = buildUpgradeGuidance('fastapi', 'pypi', 0, '1.2.0', 1);
  assert.ok(guidance.upgradeCommands[0].startsWith('pip install'));
  const minor = buildUpgradeGuidance('vite', 'npm', 6, '6.3.0', 6, '6.0.0');
  assert.strictEqual(minor.severity, 'minor');
});

test('Sample vault demonstrates every actionable DocPassport state', async () => {
  const { getSampleWorkspace } = await import('../src/services/sampleVault.ts');
  const sample = getSampleWorkspace();
  const report = auditProjectDocumentation(sample, inspectProjectStack(sample), NOW);
  const statusOf = (p: string) => report.inventory.find((i) => i.path === p)?.status;
  assert.strictEqual(statusOf('README.md'), 'stale'); // localhost:3000 vs Vite 5173
  assert.strictEqual(statusOf('docs/SETUP.md'), 'healthy');
  assert.strictEqual(statusOf('docs/SETUP-copy.md'), 'duplicate');
  assert.strictEqual(statusOf('packages/agent-runtime/README.md'), 'module-doc');
  assert.strictEqual(statusOf('notes/scratchpad.md'), 'orphan');
  assert.strictEqual(statusOf('docs/legacy-sync-design.md'), 'deprecated');
  assert.strictEqual(statusOf('docs/deploy-notes.md'), 'stale'); // broken link
  assert.strictEqual(statusOf('agents/senior-code-reviewer.md'), 'agent-system');
  assert.ok(report.missingDocs.some((m) => m.id === 'architecture'));
  assert.strictEqual(sample.tree.children!.some((c) => c.name === 'packages' && c.isFolder), true);
});

test('Auditor: age is judged relative to project activity, not wall clock', () => {
  const day = 24 * 60 * 60 * 1000;
  const dormant = auditProjectDocumentation(
    ws([
      makeDoc('README.md', `# Root\n\n${LONG}`, NOW - 500 * day),
      makeDoc('docs/guide.md', `# Guide\n\n${LONG}`, NOW - 490 * day),
    ]),
    inspectProjectStack(ws([])),
    NOW
  );
  assert.strictEqual(dormant.counts.stale, 0, 'a dormant project is not stale doc-by-doc');

  const active = auditProjectDocumentation(
    ws([
      makeDoc('README.md', `# Root\n\n${LONG}`, NOW),
      makeDoc('docs/guide.md', `# Guide\n\n${LONG}`, NOW - 300 * day),
    ]),
    inspectProjectStack(ws([])),
    NOW
  );
  assert.strictEqual(active.inventory.find((i) => i.path === 'docs/guide.md')!.status, 'stale');
});

test('Auditor: health is proportional and archived docs cost nothing', () => {
  const docs = [makeDoc('README.md', `# Root\n\n${LONG}`), makeDoc('ARCHITECTURE.md', `# Arch\n\n${LONG}`), makeDoc('DEPLOYMENT.md', `# Deploy\n\n${LONG}`)];
  for (let i = 0; i < 40; i++) docs.push(makeDoc(`archive/old-${i}.md`, `# Old ${i}\n\n${LONG}`));
  for (let i = 0; i < 60; i++) docs.push(makeDoc(`docs/topic-${i}.md`, `# Topic ${i}\n\n${LONG}`));
  const report = auditProjectDocumentation(ws(docs), inspectProjectStack(ws([])), NOW);
  assert.strictEqual(report.counts.deprecated, 40);
  assert.strictEqual(report.grade, 'A');
});

test('Auditor: ADRs, changelogs and evergreen docs are exempt from age staleness', () => {
  const day = 24 * 60 * 60 * 1000;
  const report = auditProjectDocumentation(
    ws([
      makeDoc('README.md', `# Root\n\n${LONG}`, NOW),
      makeDoc('adrs/0001-model-adapters.md', `# ADR 1\n\n${LONG}`, NOW - 400 * day),
      makeDoc('docs/adr-002-storage.md', `# ADR 2\n\n${LONG}`, NOW - 400 * day),
      makeDoc('CHANGELOG.md', `# Changelog\n\n${LONG}`, NOW - 400 * day),
      makeDoc('docs/glossary.md', `---\nevergreen: true\n---\n\n# Glossary\n\n${LONG}`, NOW - 400 * day),
      makeDoc('docs/setup.md', `# Setup\n\n${LONG}`, NOW - 400 * day),
    ]),
    inspectProjectStack(ws([])),
    NOW
  );
  const st = (p: string) => report.inventory.find((i) => i.path === p)!.status;
  assert.notStrictEqual(st('adrs/0001-model-adapters.md'), 'stale');
  assert.notStrictEqual(st('docs/adr-002-storage.md'), 'stale');
  assert.notStrictEqual(st('CHANGELOG.md'), 'stale');
  assert.notStrictEqual(st('docs/glossary.md'), 'stale');
  assert.strictEqual(st('docs/setup.md'), 'stale');
});
