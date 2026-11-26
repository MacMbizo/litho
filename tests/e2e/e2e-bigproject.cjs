// Run: npm run build, then BIG_PROJECT_DIR=<copy of a big project> node tests/e2e/e2e-bigproject.cjs (PLAYWRIGHT_CORE if needed).
// Project chat on a real-sized project (a copy of agent-skills' 3,445 docs) in the real app, with isolated
// userData: index time, asking during indexing, asking after, and whether the window stays responsive.
const { _electron } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
const APP = 'C:\\Prj\\litho';
// A folder of Markdown to use as the Notes folder, ideally a copy of a large real project (3,000+ docs).
const notes = process.env.BIG_PROJECT_DIR || path.join(process.env.LOCALAPPDATA, 'Temp', 'litho-bigproj');
if (!fs.existsSync(notes)) throw new Error('Set BIG_PROJECT_DIR to a folder of Markdown (a copy of a large project).');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'litho-big-'));
fs.mkdirSync(path.join(ud, 'docatlas'), { recursive: true });
fs.writeFileSync(path.join(ud, 'docatlas', 'notes.json'), JSON.stringify({ folder: notes, externalPaths: [] }));
fs.writeFileSync(
  path.join(ud, 'docatlas', 'ai-config.json'),
  JSON.stringify({ provider: 'ollama', models: { claude: 'claude-opus-5-5', gemini: '', openai: '', openrouter: '', ollama: 'qwen3.5:4b' }, ollamaUrl: 'http://localhost:11434' })
);
const results = [];
const check = (name, ok, detail = '') => {
  results.push(!!ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};

(async () => {
  const app = await _electron.launch({ executablePath: require(path.join(APP, 'node_modules', 'electron')), args: [APP, `--user-data-dir=${ud}`], cwd: APP });
  const errors = [];
  try {
    const win = await app.firstWindow();
    win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    win.on('pageerror', (e) => errors.push(String(e)));
    await win.waitForLoadState('domcontentloaded');
    const t0 = Date.now();
    await win.getByText('Notes', { exact: true }).first().click();
    // The sample workspace shows first; wait until the Notes workspace (the big project) has replaced it.
    await win.getByText(/Workspace: Notes/i).first().waitFor({ timeout: 180000 });
    await win.getByText('Ask Vault').waitFor({ timeout: 120000 });
    console.log(`     notes workspace loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // Watch the renderer for long frames (a frozen window) for the rest of the run.
    await win.evaluate(() => {
      window.__gaps = [];
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        window.__gaps.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const tIndex = Date.now();
    await win.getByText('Ask Vault').click();
    const status = win.getByTestId('chat-index-status');
    await status.getByText(/Indexing documents/).waitFor({ timeout: 60000 });
    check('indexing shows progress and invites questions', /You can ask now/.test(await status.innerText()), (await status.innerText()).replace(/\s+/g, ' '));

    // Ask while indexing: keyword matching, and the answer says so.
    const ask = async (q) => {
      const before = await win.getByTestId('chat-answer').count();
      const t = Date.now();
      await win.getByLabel('Question', { exact: true }).fill(q);
      await win.getByLabel('Send question').click();
      await win.waitForFunction((n) => document.querySelectorAll('[data-testid="chat-answer"]').length > n, before, { timeout: 400000 });
      // This answer's own info line (a meaning-matched local answer may have none).
      const answer = win.getByTestId('chat-answer').nth(before);
      const infoLine = answer.locator('xpath=..').getByTestId('ai-run-info');
      const info = (await infoLine.count()) ? await infoLine.innerText() : '';
      return { text: await answer.innerText(), info, ms: Date.now() - t };
    };
    const early = await ask('How do I write a new skill?');
    check('answer during indexing (keywords)', /keywords/.test(early.info) && early.text.length > 40, `${(early.ms / 1000).toFixed(1)}s · ${early.info}`);

    await status.getByText(/documents indexed/).waitFor({ timeout: 600000 });
    const indexSecs = (Date.now() - tIndex) / 1000;
    const indexed = Number(((await status.innerText()).match(/([\d,]+) documents indexed\. Matching by meaning/) || [])[1]?.replace(/,/g, ''));
    check('index finished, matching by meaning (3,000+ docs)', indexed >= 3000, `${indexSecs.toFixed(0)}s · ${(await status.innerText()).replace(/\s+/g, ' ')}`);

    const late = await ask('Which skill helps with writing a new skill, and what steps does it give?');
    const sources = await win.getByTestId('chat-sources').last().innerText().catch(() => '');
    check('answer by meaning after indexing', !/keywords/.test(late.info) && late.text.length > 40, `${(late.ms / 1000).toFixed(1)}s · info: ${late.info} · sources: ${sources.replace(/\s+/g, ' ').slice(0, 140)}`);

    const gaps = await win.evaluate(() => window.__gaps);
    const worst = Math.max(...gaps);
    const over = gaps.filter((g) => g > 250).length;
    check('window stayed responsive (no frame gap over 1 s)', worst < 1000, `worst ${worst.toFixed(0)} ms, ${over} gaps over 250 ms`);

    // Close and reopen the chat: the in-memory index is reused, so it's ready at once.
    await win.getByLabel('Close project chat').click();
    const tReopen = Date.now();
    await win.getByText('Ask Vault').click();
    await status.getByText(/documents indexed/).waitFor({ timeout: 120000 });
    console.log(`     reopened and ready in ${((Date.now() - tReopen) / 1000).toFixed(1)}s`);

    const real = errors.filter((e) => !/Autofill|DevTools/.test(e));
    check('no console errors', real.length === 0, real.slice(0, 2).join(' || '));
    const mem = await app.evaluate(({ app }) => app.getAppMetrics().reduce((n, m) => n + m.memory.workingSetSize, 0));
    console.log(`     app memory ${(mem / 1024).toFixed(0)} MB`);
  } catch (e) {
    check('run completed', false, String(e && e.message ? e.message : e).split('\n')[0]);
  } finally {
    await app.close().catch(() => {});
    console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
    fs.rmSync(ud, { recursive: true, force: true });
  }
})();
