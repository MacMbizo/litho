// Run: npm run build, then node tests/e2e/e2e-pipeline.cjs (PLAYWRIGHT_CORE=<path to playwright-core> if it is not installed).
// E2E for AI slice 3 (project chat pipeline): isolated userData, a throwaway Notes folder of fixture docs,
// real local nomic-embed-text (finder), llama3.2 (cards and thinker). No cloud calls.
const { _electron } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
// Screenshots and dumps go here, not into the repo.
const OUT = process.env.E2E_OUT || os.tmpdir();

const APP = 'C:\\Prj\\litho';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'litho-e2e-pipeline-'));
const ud = path.join(root, 'userData');
const notes = path.join(root, 'Notes');
fs.mkdirSync(path.join(ud, 'docatlas'), { recursive: true });
fs.mkdirSync(path.join(notes, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ud, 'docatlas', 'notes.json'), JSON.stringify({ folder: notes, externalPaths: [] }));
fs.writeFileSync(
  path.join(ud, 'docatlas', 'ai-config.json'),
  JSON.stringify({ provider: 'ollama', models: { claude: 'claude-opus-5-5', gemini: '', openai: '', ollama: 'llama3.2:latest' }, ollamaUrl: 'http://localhost:11434' })
);

const filler = (topic, n) =>
  Array.from({ length: n }, (_, i) => `### ${topic} note ${i + 1}\n\nThis section records routine detail about ${topic} that does not change the main decisions. It lists owners, review dates and minor follow-ups for item ${i + 1}.`).join('\n\n');
fs.writeFileSync(
  path.join(notes, 'docs', 'architecture.md'),
  `# Harbor architecture\n\nHarbor is a desktop app for tracking boat maintenance.\n\n## Storage\n\nAll data is stored locally in SQLite through better-sqlite3, because the app must work offline on the dock and users own their data. There is no server database.\n\n## Sync\n\nOptional sync uploads an encrypted export to the user's own cloud folder.\n\n${filler('architecture', 30)}`
);
fs.writeFileSync(path.join(notes, 'docs', 'deploy.md'), '# Releasing\n\nReleases are built with electron-builder and published to GitHub Releases every second Friday.\n');
fs.writeFileSync(path.join(notes, 'docs', 'payments.md'), '# Payments\n\nADR-007: subscriptions are sold through Paddle, which handles VAT.\n');
fs.writeFileSync(path.join(notes, 'docs', 'onboarding.md'), '# Onboarding\n\nNew users import their boat from a template, then add engines and trailers.\n');
fs.writeFileSync(path.join(notes, 'Meeting 2026-11-02.md'), '# Meeting\n\nWe agreed to keep the app offline-first. Next review in December.\n');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};
const countFiles = (d) => {
  if (!fs.existsSync(d)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(d, e.name)) : 1;
  return n;
};

(async () => {
  const app = await _electron.launch({ executablePath: require(path.join(APP, 'node_modules', 'electron')), args: [APP, `--user-data-dir=${ud}`], cwd: APP });
  const errors = [];
  try {
    const win = await app.firstWindow();
    win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForLoadState('domcontentloaded');
    await win.getByText('Notes', { exact: true }).first().click();
    await win.getByText('Ask Vault').waitFor({ timeout: 15000 });
    await win.getByText('Ask Vault').click();

    const status = win.getByTestId('chat-index-status');
    await status.getByText(/documents indexed/).waitFor({ timeout: 120000 });
    const st = await status.innerText();
    check('index ready, matching by meaning', /5 documents indexed\. Matching by meaning/.test(st), st);
    const cache = path.join(ud, 'docatlas', 'ai-cache');
    check('vectors cached on disk', countFiles(path.join(cache, 'embeddings')) === 5, String(countFiles(path.join(cache, 'embeddings'))));

    const ask = async (q) => {
      const before = await win.getByTestId('chat-answer').count();
      const t = Date.now();
      await win.getByLabel('Question', { exact: true }).fill(q);
      await win.getByLabel('Send question').click();
      const sawProgress = await win.getByTestId('chat-progress').isVisible().catch(() => false);
      await win.waitForFunction((n) => document.querySelectorAll('[data-testid="chat-answer"]').length > n, before, { timeout: 300000 });
      const answers = win.getByTestId('chat-answer');
      return { text: await answers.nth(before).innerText(), ms: Date.now() - t, sawProgress };
    };

    const a1 = await ask('Which database does Harbor use, and why?');
    check('answer from the docs (SQLite)', /sqlite/i.test(a1.text), a1.text.slice(0, 100).replace(/\s+/g, ' '));
    check('progress shown while answering', a1.sawProgress);
    const sources = await win.getByTestId('chat-sources').last().innerText();
    check('architecture doc among sources', /Harbor architecture/.test(sources), sources.replace(/\s+/g, ' '));
    const cardTitle = await win.getByTestId('chat-sources').last().locator('button', { hasText: 'Harbor architecture' }).getAttribute('title');
    check('long doc sent as a doc card', cardTitle === 'Sent as a doc card', cardTitle);
    check('one card cached (only the long doc)', countFiles(path.join(cache, 'cards')) === 1, String(countFiles(path.join(cache, 'cards'))));
    const info1 = await win.getByTestId('ai-run-info').last().innerText().catch(() => '');
    check('answer not marked as keyword-matched', !/keywords/.test(info1), info1);

    const a2 = await ask('How are releases published?');
    check('follow-up answered (GitHub Releases)', /github/i.test(a2.text), a2.text.slice(0, 100).replace(/\s+/g, ' '));
    check('no new card needed', countFiles(path.join(cache, 'cards')) === 1);
    console.log(`     timings: first ${a1.ms} ms, second ${a2.ms} ms`);

    const firstSources = await win.getByTestId('chat-sources').first().innerText();
    check('specific question: only the matching doc as source', firstSources.replace(/\s+/g, ' ').trim() === 'Sources: Harbor architecture', firstSources.replace(/\s+/g, ' '));
    await win.locator('.max-w-md').first().screenshot({ path: OUT + '/pipeline-drawer.png' });

    // Source chip opens the document.
    await win.getByTestId('chat-sources').first().locator('button', { hasText: 'Harbor architecture' }).click();
    await win.waitForTimeout(800);
    check('source chip opens the doc', /Harbor architecture/.test(await win.locator('body').innerText()));

    await win.screenshot({ path: OUT + '/pipeline-after.png' });
    const real = errors.filter((e) => !/Autofill|DevTools/.test(e));
    check('no console errors', real.length === 0, real.slice(0, 3).join(' || '));
  } catch (e) {
    check('run completed', false, String(e && e.message ? e.message : e).split('\n')[0]);
  } finally {
    await app.close().catch(() => {});
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    fs.rmSync(root, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  }
})();
