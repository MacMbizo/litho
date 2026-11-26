import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assessProjectBasics,
  describeProject,
  githubSlug,
  licenceKind,
  manifestDescription,
  parseRemotes,
  parseStatusV2,
  readmeSummary,
  remoteHost,
  templateReadme,
  type ProjectBasicsFacts,
  type RepoFacts,
} from '../src/services/projectBasics.ts';
import { findNestedRepos, readProjectBasics } from '../electron/projectBasics.ts';

// --- README summary ---------------------------------------------------------

test('readmeSummary skips title, badges and HTML and returns the first paragraph', () => {
  const md = [
    '<div align="center">',
    '',
    '# Cairn Guardian',
    '',
    '**A calm, local-first guardian for the files on your Windows PC.**',
    '',
    '[![CI](https://x/badge.svg)](https://x) [![License](https://y.svg)](LICENSE)',
    '</div>',
  ].join('\n');
  assert.strictEqual(readmeSummary(md), 'A calm, local-first guardian for the files on your Windows PC.');
});

test('readmeSummary ignores frontmatter, code, lists and tables', () => {
  const md = '---\ntitle: X\n---\n# App\n\n```bash\nnpm install everything here\n```\n\n- a list item that is long\n\n| a | b |\n\nTracks [meals](docs/m.md) and `nutrients` for families.\n';
  assert.strictEqual(readmeSummary(md), 'Tracks meals and nutrients for families.');
});

test('readmeSummary returns null for a README that is only a heading', () => {
  assert.strictEqual(readmeSummary('# my-app\n'), null);
  assert.strictEqual(readmeSummary('# my-app\n\nTODO\n'), null);
});

test('readmeSummary handles setext titles and clips long text', () => {
  const long = 'This app does many things. '.repeat(20);
  const out = readmeSummary(`My App\n======\n\n${long}`)!;
  assert.ok(out.length <= 241, `length ${out.length}`);
  assert.ok(out.startsWith('This app does many things.'));
});

test('readmeSummary refuses starter READMEs (Lovable, Next, Expo)', () => {
  const lovable = '# Project info\n\n## How can I edit this code?\n\nThere are several ways of editing your application.\n\n**Use your preferred IDE**\n\nIf you want to work locally using your own IDE, you can clone this repo.\n';
  assert.strictEqual(readmeSummary(lovable), null);
  assert.strictEqual(templateReadme(lovable), 'Lovable');
  assert.strictEqual(readmeSummary('This is a [Next.js](https://nextjs.org) project bootstrapped with create-next-app.\n'), null);
  assert.strictEqual(readmeSummary('# App\n\nThis is an [Expo](https://expo.dev) project created with create-expo-app.\n'), null);
  // An intro written before the starter text still counts.
  assert.strictEqual(readmeSummary('# App\n\nBooks driving lessons for small schools.\n\nThis is an Expo project created with create-expo-app.'), 'Books driving lessons for small schools.');
});

test('readmeSummary skips a leading path, metadata lines and bold pseudo-headings', () => {
  const md = 'c:\\Prj\\wellness\\README.md\n# 🦅 Student Wellness App\n\n**Production Launch Target:** Monday\n**Current Stage:** Ready\n\n---\n\n**Overview**\n\nHelps students track stress and find support.\n';
  assert.strictEqual(readmeSummary(md), 'Helps students track stress and find support.');
  // Navigation lines are skipped; text after the third "##" section isn't the intro.
  assert.strictEqual(readmeSummary('# S\n\n**[Why](#why)** · **[Start](#start)** · [AI](#ai)\n\nSightline finds the skills in a folder.'), 'Sightline finds the skills in a folder.');
  assert.strictEqual(readmeSummary('# W\n\n## A\n\n- x\n\n## B\n\n- y\n\n## C\n\n"Can we add X?" is answered here at length.'), null);
  assert.strictEqual(readmeSummary('# W\n\n## Contents\n\n- x\n\n## About\n\nA tool that books lessons.'), 'A tool that books lessons.');
  // A long bold tagline is a description, not a heading.
  assert.strictEqual(readmeSummary('# X\n\n**A calm, local-first guardian for your files.**'), 'A calm, local-first guardian for your files.');
});

test('a template README warns and falls back to the manifest description', () => {
  const r = assessProjectBasics(
    facts({
      readme: { path: 'README.md', text: 'There are several ways of editing your application.' },
      manifestDescriptions: [{ source: 'package.json', text: 'Prompt manager' }],
    })
  );
  assert.strictEqual(byId(r, 'readme').chip, 'Template README');
  assert.match(byId(r, 'readme').detail, /Lovable starter text/);
  assert.deepStrictEqual(r.description, { text: 'Prompt manager', source: 'package.json' });
});

// --- manifests and licences -------------------------------------------------

test('manifestDescription reads package.json, Cargo.toml and pyproject.toml', () => {
  assert.strictEqual(manifestDescription('package.json', '{"description":"  A thing "}'), 'A thing');
  assert.strictEqual(manifestDescription('package.json', '{bad'), null);
  assert.strictEqual(
    manifestDescription('Cargo.toml', '[package]\nname = "x"\ndescription = "Rust tool"\n[dependencies]\ndescription = "no"'),
    'Rust tool'
  );
  assert.strictEqual(manifestDescription('pyproject.toml', '[tool.ruff]\ndescription = "no"\n[project]\ndescription = \'Py app\''), 'Py app');
});

test('licenceKind recognises common licences', () => {
  assert.strictEqual(licenceKind('GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3'), 'AGPL-3.0');
  assert.strictEqual(licenceKind('MIT License\n\nCopyright'), 'MIT');
  assert.strictEqual(licenceKind('Apache License\nVersion 2.0'), 'Apache-2.0');
  assert.strictEqual(licenceKind('hello'), undefined);
});

test('remote helpers', () => {
  assert.strictEqual(remoteHost('git@github.com:MacMbizo/litho.git'), 'github.com');
  assert.strictEqual(remoteHost('https://gitlab.com/a/b'), 'gitlab.com');
  assert.strictEqual(githubSlug('https://github.com/MacMbizo/litho.git'), 'MacMbizo/litho');
  assert.strictEqual(githubSlug('git@github.com:MacMbizo/litho.git'), 'MacMbizo/litho');
  assert.strictEqual(githubSlug('https://gitlab.com/a/b'), null);
});

// --- git output parsing -----------------------------------------------------

test('parseStatusV2 reads branch, upstream, ahead/behind and dirty files', () => {
  const out = '# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b src/x.ts\n? new.txt\n';
  assert.deepStrictEqual(parseStatusV2(out), { branch: 'main', hasCommits: true, upstream: 'origin/main', ahead: 2, behind: 1, dirty: 2 });
  assert.strictEqual(parseStatusV2('# branch.oid (initial)\n# branch.head main\n').hasCommits, false);
  assert.strictEqual(parseStatusV2('# branch.oid abc\n# branch.head (detached)\n').branch, undefined);
});

test('parseRemotes keeps one URL per remote', () => {
  const out = 'origin\thttps://github.com/a/b.git (fetch)\norigin\thttps://github.com/a/b.git (push)\nup\tgit@gitlab.com:c/d.git (fetch)\n';
  assert.deepStrictEqual(parseRemotes(out), [
    { name: 'origin', url: 'https://github.com/a/b.git' },
    { name: 'up', url: 'git@gitlab.com:c/d.git' },
  ]);
});

// --- assessment -------------------------------------------------------------

const repo = (over: Partial<RepoFacts> = {}): RepoFacts => ({
  path: '',
  branch: 'main',
  hasCommits: true,
  remotes: [{ name: 'origin', url: 'https://github.com/a/b.git' }],
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
  dirty: 0,
  ...over,
});

const facts = (over: Partial<ProjectBasicsFacts> = {}): ProjectBasicsFacts => ({
  readme: { path: 'README.md', text: '# A\n\nAn app that tracks the weather for farmers.' },
  manifestDescriptions: [],
  repos: [repo()],
  gitignore: true,
  licence: { file: 'LICENSE', kind: 'AGPL-3.0' },
  checkedAt: '2026-11-26T00:00:00Z',
  ...over,
});

const byId = (r: ReturnType<typeof assessProjectBasics>, id: string) => r.checks.find((c) => c.id === id)!;

test('a complete project passes every check', () => {
  const r = assessProjectBasics(facts());
  assert.strictEqual(r.level, 'complete');
  assert.strictEqual(r.passed, r.checks.length);
  assert.strictEqual(r.description?.text, 'An app that tracks the weather for farmers.');
  assert.match(byId(r, 'remote').detail, /a\/b/);
});

test('no README and no git means missing basics; manifest description is still used', () => {
  const r = assessProjectBasics(
    facts({ readme: null, repos: [], manifestDescriptions: [{ source: 'package.json', text: 'Driving school platform' }] })
  );
  assert.strictEqual(r.level, 'missing');
  assert.strictEqual(byId(r, 'readme').chip, 'No README');
  assert.strictEqual(byId(r, 'git').chip, 'No git');
  assert.strictEqual(r.checks.find((c) => c.id === 'remote'), undefined);
  assert.deepStrictEqual(r.description, { text: 'Driving school platform', source: 'package.json' });
});

test('a repo with no remote is local only', () => {
  const r = assessProjectBasics(facts({ repos: [repo({ remotes: [], upstream: undefined })] }));
  assert.strictEqual(r.level, 'missing');
  assert.strictEqual(byId(r, 'remote').chip, 'Local only');
  assert.strictEqual(byId(r, 'pushed').status, 'pass');
});

test('a nested repo counts as git, with a note', () => {
  const r = assessProjectBasics(facts({ repos: [repo({ path: 'Vercel/pigeonprompt' })] }));
  assert.strictEqual(byId(r, 'git').status, 'pass');
  assert.match(byId(r, 'git').detail, /Vercel\/pigeonprompt/);
});

test('unpushed, never-pushed and uncommitted work are warnings', () => {
  assert.strictEqual(byId(assessProjectBasics(facts({ repos: [repo({ ahead: 3 })] })), 'pushed').chip, '3 unpushed');
  assert.strictEqual(byId(assessProjectBasics(facts({ repos: [repo({ upstream: undefined })] })), 'pushed').chip, 'Not pushed');
  const dirty = assessProjectBasics(facts({ repos: [repo({ dirty: 4 })] }));
  assert.strictEqual(byId(dirty, 'pushed').chip, 'Uncommitted');
  assert.strictEqual(dirty.level, 'partial');
  assert.strictEqual(byId(assessProjectBasics(facts({ repos: [repo({ hasCommits: false })] })), 'pushed').chip, 'No commits');
});

test('README without a paragraph warns; other hosts pass as remotes', () => {
  const r = assessProjectBasics(
    facts({ readme: { path: 'README.md', text: '# x' }, repos: [repo({ remotes: [{ name: 'origin', url: 'git@gitlab.com:a/b.git' }] })] })
  );
  assert.strictEqual(byId(r, 'readme').status, 'warn');
  assert.match(byId(r, 'remote').detail, /gitlab\.com \(not GitHub\)/);
  assert.strictEqual(r.level, 'partial');
});

test('describeProject prefers the README over the manifest', () => {
  const d = describeProject(facts({ manifestDescriptions: [{ source: 'package.json', text: 'Manifest text here' }] }));
  assert.strictEqual(d?.source, 'README.md');
  assert.strictEqual(assessProjectBasics(undefined).level, 'unknown');
});

// --- real folders and git ---------------------------------------------------

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hashDir(dir: string): string {
  const h = crypto.createHash('sha256');
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name);
      h.update(path.relative(dir, full));
      if (e.isDirectory()) walk(full);
      else {
        h.update(fs.readFileSync(full));
        h.update(String(fs.statSync(full).mtimeMs));
      }
    }
  };
  walk(dir);
  return h.digest('hex');
}

const g = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });

test('readProjectBasics reads a real repo without changing .git', { skip: !hasGit() }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'basics-'));
  try {
    fs.writeFileSync(path.join(dir, 'README.md'), '# Demo\n\nA demo app for the basics test.\n');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"demo","description":"Demo manifest","license":"MIT"}');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
    g(dir, 'init', '-q', '-b', 'main');
    g(dir, 'add', '-A');
    g(dir, 'commit', '-q', '-m', 'init');
    g(dir, 'remote', 'add', 'origin', 'https://github.com/example/demo.git');
    // Make the index stale so a plain `git status` would rewrite it.
    fs.writeFileSync(path.join(dir, 'README.md'), '# Demo\n\nA demo app for the basics test, edited.\n');
    fs.writeFileSync(path.join(dir, 'new.txt'), 'x');

    const before = hashDir(path.join(dir, '.git'));
    const f = await readProjectBasics(dir);
    assert.strictEqual(hashDir(path.join(dir, '.git')), before, '.git must not change');

    assert.strictEqual(f.repos.length, 1);
    assert.strictEqual(f.repos[0].branch, 'main');
    assert.strictEqual(f.repos[0].hasCommits, true);
    assert.strictEqual(f.repos[0].dirty, 2);
    assert.strictEqual(f.repos[0].upstream, undefined);
    assert.deepStrictEqual(f.repos[0].remotes, [{ name: 'origin', url: 'https://github.com/example/demo.git' }]);
    assert.strictEqual(f.readme?.path, 'README.md');
    assert.deepStrictEqual(f.manifestDescriptions, [{ source: 'package.json', text: 'Demo manifest' }]);
    assert.strictEqual(f.gitignore, true);
    assert.deepStrictEqual(f.licence, { kind: 'MIT' });

    const r = assessProjectBasics(f);
    assert.strictEqual(r.description?.text, 'A demo app for the basics test, edited.');
    assert.strictEqual(r.checks.find((c) => c.id === 'pushed')?.chip, 'Not pushed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readProjectBasics finds a nested repo and its README; no git means no repos', { skip: !hasGit() }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'basics-'));
  try {
    const inner = path.join(dir, 'Vercel', 'app');
    fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'node_modules', 'pkg', '.git'));
    fs.mkdirSync(inner, { recursive: true });
    fs.writeFileSync(path.join(inner, 'README.md'), '# App\n\nNested app that lives in a subfolder.\n');
    fs.writeFileSync(path.join(inner, 'LICENSE'), 'GNU AFFERO GENERAL PUBLIC LICENSE\n');
    g(inner, 'init', '-q', '-b', 'main');

    assert.deepStrictEqual(await findNestedRepos(dir), ['Vercel/app']);
    const f = await readProjectBasics(dir);
    assert.strictEqual(f.repos[0].path, 'Vercel/app');
    assert.strictEqual(f.repos[0].hasCommits, false);
    assert.strictEqual(f.readme?.path, 'Vercel/app/README.md');
    assert.deepStrictEqual(f.licence, { file: 'Vercel/app/LICENSE', kind: 'AGPL-3.0' });

    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'basics-'));
    try {
      const p = await readProjectBasics(plain);
      assert.deepStrictEqual(p.repos, []);
      assert.strictEqual(p.readme, null);
      assert.strictEqual(assessProjectBasics(p).level, 'missing');
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
