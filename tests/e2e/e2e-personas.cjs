// Run: npm run build, then node tests/e2e/e2e-personas.cjs (PLAYWRIGHT_CORE=<path to playwright-core> if it is not installed).
// E2E for AI slice 2 (personas): isolated userData and a throwaway Notes folder; a real local llama3.2 answer.
const { _electron } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');
// Screenshots and dumps go here, not into the repo.
const OUT = process.env.E2E_OUT || os.tmpdir();

const APP = 'C:\\Prj\\litho';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'litho-e2e-personas-'));
const ud = path.join(root, 'userData');
const notes = path.join(root, 'Notes');
const personas = path.join(notes, 'Personas');
fs.mkdirSync(path.join(ud, 'docatlas'), { recursive: true });
fs.mkdirSync(notes, { recursive: true });
fs.writeFileSync(path.join(ud, 'docatlas', 'notes.json'), JSON.stringify({ folder: notes, externalPaths: [] }));
fs.writeFileSync(
  path.join(ud, 'docatlas', 'ai-config.json'),
  JSON.stringify({ provider: 'ollama', models: { claude: 'claude-opus-5-5', gemini: '', openai: '', ollama: 'llama3.2:latest' }, ollamaUrl: 'http://localhost:11434' })
);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
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
    await win.getByText('AI & Settings').click();

    const section = win.getByTestId('ai-personas');
    await section.waitFor({ timeout: 15000 });
    check('Personas section shown', true);
    check('empty state', await section.getByText('No personas yet').isVisible());
    check('four task pickers', (await section.locator('select').count()) === 4);

    // Starter personas: one click adds three; the offer then disappears.
    const starterBtn = win.getByTestId('add-starter-personas');
    check('starter offer shown when empty', /Add 3 starter personas/.test(await starterBtn.innerText()));
    await starterBtn.click();
    await win.waitForFunction(() => document.querySelector('[aria-label="Persona for Project chat"]')?.textContent?.includes('Software architect'), null, { timeout: 10000 });
    const starters = fs.readdirSync(personas).sort();
    check('three starter files written', starters.join('|') === 'Product strategist.md|Software architect.md|Technical editor.md', starters.join('|'));
    check('starter offer gone once added', (await starterBtn.count()) === 0);
    await win.getByLabel('Persona for Project chat').selectOption('Software architect.md');
    await win.getByLabel('Keep personas cached for an hour').check();

    // Create from the UI: the file appears on disk and opens in the editor.
    await section.getByText('New persona…').click();
    await win.getByLabel('New persona name').fill('Test architect');
    await section.getByRole('button', { name: 'Create' }).click();
    const created = path.join(personas, 'Test architect.md');
    await win.waitForTimeout(1500);
    check('persona file created', fs.existsSync(created));
    check('settings closed after create', !(await section.isVisible().catch(() => false)));
    await win.waitForTimeout(3000);
    await win.screenshot({ path: OUT + '/after-create.png' });
    const editorText = await win.locator('body').innerText();
    fs.writeFileSync(OUT + '/after-create.txt', editorText);
    const values = await win.locator('textarea, [contenteditable="true"]').evaluateAll((els) => els.map((e) => ('value' in e ? e.value : e.innerText)).join(' | '));
    check('new persona opened in the editor', /Write who the AI should be/.test(values + editorText) && /Test architect/.test(editorText), values.slice(0, 60));
    check('template paragraph is one line', /how it writes\. Long is fine/.test(values));

    // A second persona written outside the app, picked for Summaries.
    fs.writeFileSync(
      path.join(personas, 'Pirate.md'),
      '---\nname: Pirate captain\ndescription: Talks like a pirate\n---\n\n# Pirate captain\n\nYou are a pirate captain. Begin every answer with the exact word "Arrr" and speak like a pirate throughout.\n'
    );
    await win.getByText('AI & Settings').click();
    await section.waitFor();
    const summarySelect = win.getByLabel('Persona for Summaries');
    await win.waitForFunction(() => document.querySelector('[aria-label="Persona for Summaries"]')?.textContent?.includes('Pirate captain'), null, { timeout: 10000 });
    const optionText = await summarySelect.locator('option').allInnerTexts();
    check('both personas listed with sizes', optionText.some((t) => /^Pirate captain \(22 words, no cache\)$/.test(t)) && optionText.includes('Software architect (644 words)') && optionText.some((t) => t.startsWith('Test architect')), optionText.join(' | '));
    await summarySelect.selectOption('Pirate.md');
    await section.scrollIntoViewIfNeeded();
    await section.screenshot({ path: OUT + '/settings-personas.png' });
    await win.getByRole('button', { name: 'Save', exact: true }).click();
    await win.waitForTimeout(1200);
    const cfg = JSON.parse(fs.readFileSync(path.join(ud, 'docatlas', 'ai-config.json'), 'utf-8'));
    check('choices saved in ai-config.json', cfg.personas?.summarize === 'Pirate.md' && cfg.personas?.chat === 'Software architect.md', JSON.stringify(cfg.personas));
    check('one-hour cache saved', cfg.cacheTtl === '1h', cfg.cacheTtl);

    // A real local answer through the gateway, with the persona in front.
    await win.getByText('AI Assist').first().click();
    await win.getByRole('button', { name: 'Generate' }).click();
    const info = win.getByTestId('ai-run-info');
    await info.waitFor({ timeout: 240000 });
    const infoText = await info.innerText();
    check('run line names the persona', /Persona: Pirate captain/.test(infoText), infoText);
    const answer = await win.locator('.whitespace-pre-wrap').first().innerText();
    check('answer follows the persona', /arr/i.test(answer), answer.slice(0, 80).replace(/\s+/g, ' '));
    await win.keyboard.press('Escape');
    await win.mouse.click(5, 5);

    // A persona that disappears is named as missing and gives a plain error.
    fs.rmSync(path.join(personas, 'Pirate.md'));
    await win.getByText('AI & Settings').click();
    await section.waitFor();
    await win.waitForTimeout(800);
    const opts2 = await win.getByLabel('Persona for Summaries').locator('option').allInnerTexts();
    check('missing persona shown as missing', opts2.includes('Pirate (missing)'), opts2.join(' | '));
    await win.getByRole('button', { name: 'Cancel' }).click();
    await win.getByText('AI Assist').first().click();
    await win.getByRole('button', { name: 'Generate' }).click();
    await win.getByText(/no longer in the Personas folder/).waitFor({ timeout: 15000 });
    check('plain error for a missing persona', true);

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
