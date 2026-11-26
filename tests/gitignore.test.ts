import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendIgnoreLines, ignoreGaps, isIgnored, missingIgnoreLines, reviewFileName, riskyFileName, secretInText, validateAction } from '../src/services/basicsFixes.ts';
import { assessProjectBasics } from '../src/services/projectBasics.ts';
import { BasicsController, planGitignore, stillBlocking } from '../electron/basicsFixer.ts';
import { readProjectBasics } from '../electron/projectBasics.ts';

// DrivingSchool's real .gitignore (the Vite starter): no .env rule.
const VITE_GITIGNORE = [
  '# Logs', 'logs', '*.log', 'npm-debug.log*', '', 'node_modules', 'dist', 'dist-ssr', '*.local', '',
  '# Editor directories and files', '.vscode/*', '!.vscode/extensions.json', '.idea', '.DS_Store', '*.sw?',
].join('\n');

test('isIgnored follows the git rules that matter', () => {
  assert.strictEqual(isIgnored(VITE_GITIGNORE, '.env'), false);
  assert.strictEqual(isIgnored(VITE_GITIGNORE, '.env.local'), true, '*.local');
  assert.strictEqual(isIgnored(VITE_GITIGNORE, 'node_modules/react/index.js'), true, 'inside an ignored folder');
  assert.strictEqual(isIgnored(VITE_GITIGNORE, 'src/app.log'), true, 'unanchored glob matches at any depth');
  assert.strictEqual(isIgnored(VITE_GITIGNORE, '.vscode/settings.json'), true);
  assert.strictEqual(isIgnored(VITE_GITIGNORE, '.vscode/extensions.json'), false, 'negation');
  const g = 'build/\n/secret.txt\ndocs/**/*.tmp\n.env*\n!.env.example\n';
  assert.strictEqual(isIgnored(g, 'build', true), true);
  assert.strictEqual(isIgnored(g, 'build', false), false, 'dir-only rule skips a file named build');
  assert.strictEqual(isIgnored(g, 'secret.txt'), true);
  assert.strictEqual(isIgnored(g, 'sub/secret.txt'), false, 'leading slash anchors');
  assert.strictEqual(isIgnored(g, 'docs/a/b/x.tmp'), true, '**');
  assert.strictEqual(isIgnored(g, '.env.production'), true);
  assert.strictEqual(isIgnored(g, '.env.example'), false);
  assert.strictEqual(isIgnored('/my\\[file\\].js\n', 'my[file].js'), true, 'escaped brackets match literally');
});

test("missingIgnoreLines for DrivingSchool's .gitignore adds the env rules, keeps .env.example", () => {
  const entries = [
    { name: '.env', isDir: false },
    { name: '.env.example', isDir: false },
    { name: 'node_modules', isDir: true },
    { name: 'dist', isDir: true },
    { name: 'playwright-report', isDir: true },
  ];
  const add = missingIgnoreLines(VITE_GITIGNORE, entries);
  assert.deepStrictEqual(add, ['.env', '.env.*', '!.env.example', '*.pem', '*.key']);
  const after = appendIgnoreLines(VITE_GITIGNORE, add);
  assert.ok(after.startsWith(VITE_GITIGNORE), 'existing lines kept as they were');
  assert.strictEqual(isIgnored(after, '.env'), true);
  assert.strictEqual(isIgnored(after, '.env.production'), true);
  assert.strictEqual(isIgnored(after, '.env.example'), false);
  assert.deepStrictEqual(missingIgnoreLines(after, entries), [], 'nothing missing the second time');
  assert.deepStrictEqual(missingIgnoreLines('', [{ name: '.venv', isDir: true }]).slice(-1), ['.venv/']);
  assert.match(appendIgnoreLines('a\r\nb', ['.env']), /^a\r\nb\r\n\r\n# Added by DocAtlas.*\r\n\.env\r\n$/);
});

// Fake Supabase-style keys, built here: header.payload.signature with the role in the payload.
const jwt = (role: string) =>
  [
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    Buffer.from(JSON.stringify({ iss: 'supabase', role, iat: 1700000000 })).toString('base64url'),
    'c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWc',
  ].join('.');

test('ignoreGaps warns only on real risks; debug.keystore is not a secret', () => {
  const next = '.env\n.env*.local\nnode_modules\n';
  assert.deepStrictEqual(ignoreGaps(next, [{ name: '.env.production', isDir: false }]), ['.env.production'], 'an unignored env file present');
  assert.deepStrictEqual(ignoreGaps(next, [{ name: 'node_modules', isDir: true }]), [], 'nothing at risk');
  assert.deepStrictEqual(ignoreGaps('', [{ name: '.env.example', isDir: false }, { name: 'dist', isDir: true }]), ['.env', 'dist/']);
  assert.strictEqual(riskyFileName('apps/mobile/android/app/debug.keystore'), null);
  assert.ok(riskyFileName('android/app/release.keystore'));
});

test('secretInText: Supabase service_role, sb_secret, DB URLs; anon keys and local DBs pass', () => {
  assert.match(secretInText(`const key = "${jwt('service_role')}";`)!, /service_role/);
  assert.strictEqual(secretInText(`const key = "${jwt('anon')}";`), null, 'anon keys are public by design');
  assert.strictEqual(secretInText('SUPABASE_KEY=sb_secret_' + 'a1B2'.repeat(8)), 'Supabase secret key');
  assert.strictEqual(secretInText('postgresql://admin:S3cr3tPass@db.prod-host.io:5432/app'), 'database URL with a password');
  assert.strictEqual(secretInText('postgres://postgres:postgres@localhost:5432/dev'), null);
  assert.strictEqual(secretInText('postgres://user:password@db.host.io/app'), null, 'placeholder password');
  assert.strictEqual(secretInText('DATABASE_URL=postgres://${USER}:${PASS}@host/db'), null);
  // A placeholder first doesn't hide a real key later in the same file.
  assert.strictEqual(secretInText('ghp_' + 'x'.repeat(36) + '\nreal: ghp_' + 'Ab1'.repeat(12)), 'GitHub token');
});

test('reviewFileName flags names that suggest credentials, not env files or ordinary code', () => {
  assert.ok(reviewFileName('TEST_CREDENTIALS.md'));
  assert.ok(reviewFileName('config/secrets.ts'));
  assert.strictEqual(reviewFileName('.env'), null, 'env files are a hard block, not a review');
  assert.strictEqual(reviewFileName('src/App.tsx'), null);
  const f = [
    { path: '.env', reason: 'x', level: 'block' as const },
    { path: 'TEST_CREDENTIALS.md', reason: 'x', level: 'review' as const },
  ];
  assert.deepStrictEqual(stillBlocking(f, ['TEST_CREDENTIALS.md', '.env']).map((x) => x.path), ['.env'], 'a block can never be confirmed');
});

test('validateAction: leave-out paths and confirmations; no newline or negation tricks', () => {
  assert.deepStrictEqual(validateAction({ kind: 'start-git', ignore: ['scripts\\seed.js'], confirmed: ['TEST_CREDENTIALS.md'] }), {
    kind: 'start-git',
    ignore: ['scripts/seed.js'],
    confirmed: ['TEST_CREDENTIALS.md'],
  });
  assert.throws(() => validateAction({ kind: 'start-git', ignore: ['a\n!b'] }));
  assert.throws(() => validateAction({ kind: 'start-git', ignore: ['!.env'] }));
  assert.throws(() => validateAction({ kind: 'untrack-secrets', repoPath: '', paths: [] }), /No files/);
});

// --- real folders ---------------------------------------------------------------------

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gitignore-'));
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
const known = (roots: string[]) => async (p: string) => roots.some((r) => path.resolve(r).toLowerCase() === path.resolve(p).toLowerCase());
const ID = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' };

/** A folder shaped like DrivingSchool: Vite .gitignore, a .env, a script with a hardcoded service_role key. */
function drivingSchoolLike(): string {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, '.gitignore'), VITE_GITIGNORE);
  fs.writeFileSync(path.join(dir, '.env'), 'VITE_SUPABASE_URL=https://x.supabase.co\n');
  fs.writeFileSync(path.join(dir, '.env.example'), 'VITE_SUPABASE_URL=\n');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"ds"}');
  fs.writeFileSync(path.join(dir, 'create-test-users.js'), `const supabase = createClient(url, "${jwt('service_role')}");\n`);
  fs.writeFileSync(path.join(dir, 'TEST_CREDENTIALS.md'), '# Test logins\n');
  fs.mkdirSync(path.join(dir, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'x', 'i.js'), '');
  return dir;
}

test('Start git on a DrivingSchool-like folder: fixes .gitignore itself, then asks only about real problems', async () => {
  const dir = drivingSchoolLike();
  const saved = { ...process.env };
  Object.assign(process.env, ID, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.email', GIT_CONFIG_VALUE_0: 't@example.com' });
  try {
    const plan = await planGitignore(dir);
    assert.deepStrictEqual(plan, { exists: true, additions: ['.env', '.env.*', '!.env.example', '*.pem', '*.key'] });
    const c = new BasicsController(known([dir]));

    const first = await c.run(dir, { kind: 'start-git' });
    assert.strictEqual(first.ok, false);
    // .env is no longer a problem: DocAtlas added it to .gitignore itself.
    assert.deepStrictEqual(
      first.findings!.map((f) => [f.path, f.level]),
      [
        ['create-test-users.js', 'block'],
        ['TEST_CREDENTIALS.md', 'review'],
      ]
    );
    assert.match(first.findings![0].reason, /service_role/);
    assert.match(first.message, /Added 5 lines to \.gitignore/);
    assert.ok(!fs.existsSync(path.join(dir, '.git')));
    assert.ok(fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8').startsWith(VITE_GITIGNORE), 'original lines untouched');

    // A real key can't be waved through.
    const forced = await c.run(dir, { kind: 'start-git', confirmed: ['create-test-users.js', 'TEST_CREDENTIALS.md'] });
    assert.deepStrictEqual(forced.findings!.map((f) => f.path), ['create-test-users.js']);

    // Leave the script out, include the checked doc.
    const done = await c.run(dir, { kind: 'start-git', ignore: ['create-test-users.js'], confirmed: ['TEST_CREDENTIALS.md'] });
    assert.ok(done.ok, done.message);
    const files = git(dir, 'ls-files').split('\n').sort();
    assert.deepStrictEqual(files, ['.env.example', '.gitignore', 'TEST_CREDENTIALS.md', 'package.json']);
    assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8'), /\n\/create-test-users\.js\n/);
    assert.ok(fs.existsSync(path.join(dir, 'create-test-users.js')), 'left-out file stays on disk');
  } finally {
    process.env = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('existing repo with a committed .env: basics flags it; Fix .gitignore and Stop tracking fix it', async () => {
  const dir = tmp();
  const saved = { ...process.env };
  Object.assign(process.env, ID);
  try {
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
    fs.writeFileSync(path.join(dir, '.env'), 'K=1\n');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'init');

    const facts = await readProjectBasics(dir);
    assert.deepStrictEqual(facts.repos[0].trackedSecrets, ['.env']);
    assert.deepStrictEqual(facts.gitignoreGaps, ['.env'], 'only real risks warn; key patterns are added by fixes, not flagged');
    const report = assessProjectBasics(facts);
    assert.strictEqual(report.checks.find((x) => x.id === 'secrets')!.status, 'fail');
    assert.strictEqual(report.checks.find((x) => x.id === 'gitignore')!.chip, '.env not ignored');
    assert.strictEqual(report.level, 'missing');

    const c = new BasicsController(known([dir]));
    assert.match((await c.run(dir, { kind: 'untrack-secrets', repoPath: '', paths: ['a.txt'] })).message, /isn't a secrets file/);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'b');
    git(dir, 'add', 'a.txt');
    assert.match((await c.run(dir, { kind: 'untrack-secrets', repoPath: '', paths: ['.env'] })).message, /Other changes are staged/);
    git(dir, 'reset', '-q');

    const un = await c.run(dir, { kind: 'untrack-secrets', repoPath: '', paths: ['.env'] });
    assert.ok(un.ok, un.message);
    assert.ok(fs.existsSync(path.join(dir, '.env')), '.env stays on disk');
    assert.ok(!git(dir, 'ls-files').split('\n').includes('.env'));
    assert.strictEqual(git(dir, 'log', '-1', '--format=%s'), 'chore: stop tracking secret files');
    assert.deepStrictEqual(git(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['.env', '.gitignore'], 'the commit holds only this');
    assert.match(git(dir, 'status', '--porcelain'), /a\.txt/, 'other changes untouched');

    const fixed = await c.run(dir, { kind: 'update-gitignore', repoPath: '' });
    assert.ok(fixed.ok);
    const after = assessProjectBasics(await readProjectBasics(dir));
    assert.strictEqual(after.checks.find((x) => x.id === 'secrets'), undefined);
    assert.strictEqual(after.checks.find((x) => x.id === 'gitignore')!.status, 'pass');
  } finally {
    process.env = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
