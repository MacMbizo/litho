import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  draftReadme,
  gitignoreFor,
  insertDescription,
  licenceText,
  riskyFileName,
  secretInText,
  suggestRepoName,
  validateAction,
} from '../src/services/basicsFixes.ts';
import { readmeSummary } from '../src/services/projectBasics.ts';
import { BasicsController, scanFiles } from '../electron/basicsFixer.ts';

// --- pure helpers ---------------------------------------------------------------

test('validateAction accepts the five actions and refuses bad input', () => {
  assert.deepStrictEqual(validateAction({ kind: 'start-git' }), { kind: 'start-git' });
  assert.strictEqual(validateAction({ kind: 'push', repoPath: 'Vercel\\app\\' }).kind, 'push');
  assert.deepStrictEqual(validateAction({ kind: 'push', repoPath: 'Vercel\\app\\' }), { kind: 'push', repoPath: 'Vercel/app' });
  const pub = validateAction({ kind: 'publish-github', repoPath: '', name: 'my-app', visibility: 'private', description: 'Line one\nline two' });
  assert.deepStrictEqual(pub, { kind: 'publish-github', repoPath: '', name: 'my-app', visibility: 'private', description: 'Line one line two' });
  assert.throws(() => validateAction({ kind: 'publish-github', repoPath: '', name: 'bad name', visibility: 'private' }), /letters, numbers/);
  assert.throws(() => validateAction({ kind: 'publish-github', repoPath: '', name: 'x', visibility: 'internal' }), /visibility/);
  assert.throws(() => validateAction({ kind: 'push', repoPath: '../other' }), /repo path/);
  assert.throws(() => validateAction({ kind: 'push', repoPath: 'C:/x' }), /repo path/);
  assert.throws(() => validateAction({ kind: 'add-description', readmePath: 'src/index.ts', expected: '', description: 'x' }), /Not a README/);
  assert.throws(() => validateAction({ kind: 'add-description', readmePath: 'README.md', expected: '', description: '   ' }), /empty/);
  assert.throws(() => validateAction({ kind: 'rm-rf' }), /Unknown/);
});

test('suggestRepoName makes folder names GitHub-safe', () => {
  assert.strictEqual(suggestRepoName('Back Cement'), 'Back-Cement');
  assert.strictEqual(suggestRepoName('  my app! '), 'my-app');
  assert.strictEqual(suggestRepoName('!!!'), 'project');
});

test('draftReadme includes the description, stack, commands and licence, and reads back as the description', () => {
  const md = draftReadme({
    name: 'DrivingSchool',
    description: 'Books lessons and tracks learners for driving schools.',
    frameworks: ['TypeScript', 'Expo', 'Supabase'],
    scripts: { dev: 'expo start', test: 'jest', lint: 'eslint .' },
    packageManager: 'pnpm',
    licence: 'AGPL-3.0',
  });
  assert.match(md, /^# DrivingSchool\n\nBooks lessons/);
  assert.match(md, /- Expo\n- Supabase\n- TypeScript/);
  assert.match(md, /pnpm install\npnpm dev\npnpm test/);
  assert.match(md, /AGPL-3\.0\. See \[LICENSE\]/);
  assert.strictEqual(readmeSummary(md), 'Books lessons and tracks learners for driving schools.');
  assert.match(draftReadme({ name: 'x', description: '', frameworks: [], scripts: { start: 'node .' } }), /npm install\nnpm start/);
});

test('insertDescription puts the paragraph under the title, after badges, keeping CRLF', () => {
  assert.strictEqual(insertDescription('# App\n\n## Setup\n', 'Does a thing.'), '# App\n\nDoes a thing.\n\n## Setup\n');
  assert.strictEqual(
    insertDescription('# App\r\n[![CI](x)](y)\r\n\r\nThere are several ways of editing.\r\n', 'Tracks stock.'),
    '# App\r\n[![CI](x)](y)\r\n\r\nTracks stock.\r\n\r\nThere are several ways of editing.\r\n'
  );
  assert.strictEqual(insertDescription('---\ntitle: x\n---\n# App\nBody', 'D.'), '---\ntitle: x\n---\n# App\n\nD.\n\nBody');
  assert.strictEqual(insertDescription('Just text.', 'D.'), 'D.\n\nJust text.');
  // Afterwards the summary finds it, even ahead of a starter README.
  const lovable = insertDescription('# Project info\n\n## How can I edit this code?\n\nThere are several ways of editing your application.\n', 'Manages AI prompts for a team.');
  assert.strictEqual(readmeSummary(lovable), 'Manages AI prompts for a team.');
});

test('gitignoreFor always ignores env files and adds stack folders', () => {
  const g = gitignoreFor({ node: true, python: true });
  for (const line of ['.env', '.env.*', '!.env.example', 'node_modules/', '__pycache__/', '.venv/']) assert.ok(g.split('\n').includes(line), line);
  assert.ok(!gitignoreFor({}).includes('node_modules'));
});

test('riskyFileName and secretInText', () => {
  assert.ok(riskyFileName('.env'));
  assert.ok(riskyFileName('apps/api/.env.local'));
  assert.strictEqual(riskyFileName('.env.example'), null);
  assert.ok(riskyFileName('certs/server.pem'));
  assert.ok(riskyFileName('id_ed25519'));
  assert.ok(riskyFileName('service-account-prod.json'));
  assert.strictEqual(riskyFileName('src/env.ts'), null);
  assert.strictEqual(secretInText('const k = "AKIAIOSFODNN7EXAMPLQ";'), 'AWS access key');
  assert.strictEqual(secretInText('-----BEGIN OPENSSH PRIVATE KEY-----'), 'private key');
  assert.strictEqual(secretInText('token: ghp_' + 'a'.repeat(36)), 'GitHub token');
  assert.strictEqual(secretInText('ANTHROPIC_API_KEY=sk-ant-api03-' + 'Ab1'.repeat(10)), 'Anthropic API key');
  assert.strictEqual(secretInText('OPENAI_API_KEY=sk-your-key-goes-here-xxxxxxxxxxxxxxxxxxxx'), null);
  assert.strictEqual(secretInText('//registry.npmjs.org/:_authToken=${NPM_TOKEN}'), null);
  assert.strictEqual(secretInText('just code'), null);
});

test('licenceText fills MIT placeholders, writes Proprietary itself, and validateAction checks licences', () => {
  assert.strictEqual(licenceText('MIT', 'MIT License\n\nCopyright (c) [year] [fullname]\n', 'Ada', 2026), 'MIT License\n\nCopyright (c) 2026 Ada\n');
  assert.match(licenceText('Proprietary', null, 'Ada', 2026), /^Copyright \(c\) 2026 Ada\. All rights reserved\./);
  assert.deepStrictEqual(validateAction({ kind: 'add-licence', repoPath: '', licence: 'AGPL-3.0', holder: ' Ada ', year: '2026' }), {
    kind: 'add-licence',
    repoPath: '',
    licence: 'AGPL-3.0',
    holder: 'Ada',
    year: 2026,
  });
  assert.throws(() => validateAction({ kind: 'add-licence', repoPath: '', licence: 'WTFPL', holder: 'A', year: 2026 }), /Unknown licence/);
  assert.throws(() => validateAction({ kind: 'add-licence', repoPath: '', licence: 'MIT', holder: '  ', year: 2026 }), /copyright/);
});

// --- real folders -------------------------------------------------------------------

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'basicsfix-'));
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
const known = (roots: string[]) => async (p: string) => roots.some((r) => path.resolve(r).toLowerCase() === path.resolve(p).toLowerCase());

// Tests need a git identity; set it per repo through env so the owner's config isn't touched.
const ID_ENV = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' };

test('scanFiles flags env files, keys, secrets and huge counts', async () => {
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'X=1');
    fs.writeFileSync(path.join(dir, 'config.ts'), 'export const k = "ghp_' + 'b'.repeat(36) + '";');
    fs.writeFileSync(path.join(dir, 'ok.ts'), 'export const a = 1;');
    fs.writeFileSync(path.join(dir, 'img.bin'), Buffer.from([0, 1, 2, 3]));
    const f = await scanFiles(dir, ['.env', 'config.ts', 'ok.ts', 'img.bin', 'gone.txt']);
    assert.deepStrictEqual(f.map((x) => x.path), ['.env', 'config.ts']);
    const many = await scanFiles(dir, Array.from({ length: 5001 }, (_, i) => `f${i}`), { limitCount: true });
    assert.match(many[0].reason, /5001 files/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('create README never overwrites; add description is compare-and-write; unknown projects are refused', async () => {
  const dir = tmp();
  try {
    const c = new BasicsController(known([dir]));
    await assert.rejects(c.run(path.join(os.tmpdir(), 'not-scanned'), { kind: 'start-git' }), /only changes projects it has scanned/);
    const r1 = await c.run(dir, { kind: 'create-readme', content: '# A\n\nAn app.' });
    assert.ok(r1.ok, r1.message);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'README.md'), 'utf-8'), '# A\n\nAn app.\n');
    const r2 = await c.run(dir, { kind: 'create-readme', content: '# B' });
    assert.strictEqual(r2.ok, false);
    assert.match(r2.message, /never overwrites/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'README.md'), 'utf-8'), '# A\n\nAn app.\n');

    const stale = await c.run(dir, { kind: 'add-description', readmePath: 'README.md', expected: '# old', description: 'New.' });
    assert.match(stale.message, /changed since it was read/);
    const ok = await c.run(dir, { kind: 'add-description', readmePath: 'README.md', expected: '# A\n\nAn app.\n', description: 'Tracks things.' });
    assert.ok(ok.ok, ok.message);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'README.md'), 'utf-8'), '# A\n\nTracks things.\n\nAn app.\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('add licence: writes LICENSE from the template, never overwrites, reports offline', async () => {
  const dir = tmp();
  try {
    const asked: string[] = [];
    const c = new BasicsController(known([dir]), async (key) => {
      asked.push(key);
      return 'GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007\n' + 'x'.repeat(300);
    });
    const r = await c.run(dir, { kind: 'add-licence', repoPath: '', licence: 'AGPL-3.0', holder: 'Ada', year: 2026 });
    assert.ok(r.ok, r.message);
    assert.deepStrictEqual(asked, ['agpl-3.0']);
    assert.match(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf-8'), /^GNU AFFERO/);
    const again = await c.run(dir, { kind: 'add-licence', repoPath: '', licence: 'MIT', holder: 'Ada', year: 2026 });
    assert.match(again.message, /LICENSE already exists/);

    const dir2 = tmp();
    try {
      const offline = new BasicsController(known([dir2]), async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      });
      const o = await offline.run(dir2, { kind: 'add-licence', repoPath: '', licence: 'MIT', holder: 'Ada', year: 2026 });
      assert.strictEqual(o.ok, false);
      assert.match(o.message, /Nothing was written/);
      assert.ok(!fs.existsSync(path.join(dir2, 'LICENSE')));
      const p = await offline.run(dir2, { kind: 'add-licence', repoPath: '', licence: 'Proprietary', holder: 'MCC', year: 2026 });
      assert.ok(p.ok, 'Proprietary needs no download');
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('start git: writes .gitignore, refuses secrets and removes its .git, then commits once clean', { skip: !gitAvailable() }, async () => {
  const dir = tmp();
  const saved = { ...process.env };
  Object.assign(process.env, ID_ENV);
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x"}');
    fs.mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'dep', 'index.js'), '');
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1');
    fs.writeFileSync(path.join(dir, 'keys.txt'), '-----BEGIN RSA PRIVATE KEY-----\nabc');
    const c = new BasicsController(known([dir]));

    // user.email is read from git config; give this repo-less folder one via the global env override.
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'user.email';
    process.env.GIT_CONFIG_VALUE_0 = 't@example.com';

    const blocked = await c.run(dir, { kind: 'start-git' });
    assert.strictEqual(blocked.ok, false);
    // .env is ignored by the new .gitignore, so only the key file blocks.
    assert.deepStrictEqual(blocked.findings?.map((f) => f.path), ['keys.txt']);
    assert.deepStrictEqual(blocked.wrote, ['.gitignore']);
    assert.ok(!fs.existsSync(path.join(dir, '.git')), 'the .git it created is removed');
    assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8'), /node_modules\//);

    fs.rmSync(path.join(dir, 'keys.txt'));
    const done = await c.run(dir, { kind: 'start-git' });
    assert.ok(done.ok, done.message);
    assert.match(done.message, /2 files in the first commit on main/);
    assert.strictEqual(git(dir, 'log', '--format=%s'), 'chore: initial commit');
    assert.deepStrictEqual(git(dir, 'ls-files').split('\n').sort(), ['.gitignore', 'package.json']);

    const again = await c.run(dir, { kind: 'start-git' });
    assert.match(again.message, /already a git repository/);
  } finally {
    process.env = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('start git refuses a folder with a nested repo or inside another repo', { skip: !gitAvailable() }, async () => {
  const dir = tmp();
  try {
    fs.mkdirSync(path.join(dir, 'app'));
    git(path.join(dir, 'app'), 'init', '-q');
    const c = new BasicsController(known([dir, path.join(dir, 'app', 'sub')]));
    assert.match((await c.run(dir, { kind: 'start-git' })).message, /already lives in app\//);
    fs.mkdirSync(path.join(dir, 'app', 'sub'));
    assert.match((await c.run(path.join(dir, 'app', 'sub'), { kind: 'start-git' })).message, /already inside the git repository/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('push: sets upstream the first time, scans unpushed commits, refuses secrets', { skip: !gitAvailable() }, async () => {
  const dir = tmp();
  const remote = tmp();
  const saved = { ...process.env };
  Object.assign(process.env, ID_ENV);
  try {
    git(remote, 'init', '-q', '--bare', '-b', 'main');
    git(dir, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'a');
    git(dir, 'remote', 'add', 'origin', remote);
    const c = new BasicsController(known([dir]));

    const first = await c.run(dir, { kind: 'push', repoPath: '' });
    assert.ok(first.ok, first.message);
    assert.match(first.message, /set it as the upstream/);
    assert.strictEqual(git(dir, 'rev-parse', '--abbrev-ref', '@{u}'), 'origin/main');

    // A secret committed and then deleted is still in the unpushed history: refuse.
    fs.writeFileSync(path.join(dir, '.env.production'), 'K=1');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'oops');
    git(dir, 'rm', '-q', '.env.production');
    git(dir, 'commit', '-q', '-m', 'remove');
    const refused = await c.run(dir, { kind: 'push', repoPath: '' });
    assert.strictEqual(refused.ok, false);
    assert.deepStrictEqual(refused.findings?.map((f) => f.path), ['.env.production']);
    assert.notStrictEqual(git(dir, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'main'));

    // Clean up history, then a normal push works.
    git(dir, 'reset', '-q', '--hard', 'origin/main');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'b');
    const second = await c.run(dir, { kind: 'push', repoPath: '' });
    assert.ok(second.ok, second.message);
    assert.strictEqual(git(dir, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'main'));
    assert.match((await c.run(dir, { kind: 'push', repoPath: '' })).message, /nothing to push/);

    // Publishing a repo that already has a remote is refused before gh is touched.
    assert.match((await c.run(dir, { kind: 'publish-github', repoPath: '', name: 'x', visibility: 'private' })).message, /already has a remote/);
  } finally {
    process.env = saved;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  }
});
