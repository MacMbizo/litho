/**
 * Project basics: what a project is about (one line), and whether it meets the owner's standard of
 * README + git + a remote (GitHub) + everything pushed, plus .gitignore and a licence.
 * Pure functions only; the facts are gathered in the main process (electron/projectBasics.ts).
 */

export interface RepoFacts {
  /** Repo folder relative to the project root ('' = the root itself). */
  path: string;
  branch?: string;
  /** false for a fresh `git init` with nothing committed yet. */
  hasCommits: boolean;
  remotes: Array<{ name: string; url: string }>;
  /** e.g. origin/main; unset when the branch was never pushed. */
  upstream?: string;
  ahead: number;
  behind: number;
  /** Files with uncommitted changes (tracked or untracked). */
  dirty: number;
  /** git could not be read (not installed, unsafe directory, timeout). */
  error?: string;
  /** Committed files that hold secrets by their kind (.env, keys, credential files). */
  trackedSecrets?: string[];
}

export interface ProjectBasicsFacts {
  /** README found at the root or, failing that, in the folder of a nested repo. */
  readme: { path: string; text: string } | null;
  manifestDescriptions: Array<{ source: string; text: string }>;
  /** Empty when no repo was found at the root or up to 3 levels below it. */
  repos: RepoFacts[];
  gitignore: boolean;
  /** Safety lines the existing .gitignore lacks (e.g. ".env"), and the folder it's in ('' = root). */
  gitignoreGaps?: string[];
  gitignoreDir?: string;
  licence: { file?: string; kind?: string } | null;
  checkedAt: string;
}

export type BasicsCheckId = 'readme' | 'git' | 'remote' | 'pushed' | 'gitignore' | 'secrets' | 'licence';
export type BasicsStatus = 'pass' | 'warn' | 'fail';

export interface BasicsCheck {
  id: BasicsCheckId;
  label: string;
  status: BasicsStatus;
  /** Short label for a card chip when not passing, e.g. "No README". */
  chip?: string;
  detail: string;
  required: boolean;
}

export type BasicsLevel = 'complete' | 'partial' | 'missing' | 'unknown';

export interface BasicsReport {
  level: BasicsLevel;
  checks: BasicsCheck[];
  passed: number;
  description: ProjectDescription | null;
}

export interface ProjectDescription {
  text: string;
  /** Where it came from, e.g. "README.md" or "package.json". */
  source: string;
}

const MAX_DESCRIPTION = 240;

/** Strips Markdown inline syntax so a paragraph reads as plain text. */
function plainInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1') // reference links
    .replace(/<[^>]+>/g, '') // html tags
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|[^*\w])[*_]([^*_\n]+)[*_](?=[^*\w]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(s: string): string {
  if (s.length <= MAX_DESCRIPTION) return s;
  const cut = s.slice(0, MAX_DESCRIPTION);
  const sentence = cut.lastIndexOf('. ');
  if (sentence > MAX_DESCRIPTION * 0.5) return cut.slice(0, sentence + 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:\s]+$/, '') + '…';
}

/** Starter READMEs that tools generate: their text says nothing about the project. */
const TEMPLATE_READMES: Array<[RegExp, string]> = [
  [/There are several ways of editing your application|Welcome to your Lovable project|lovable\.dev\/projects/i, 'Lovable'],
  [/bootstrapped with \[?Create React App/i, 'Create React App'],
  [/This is a \[?Next\.js\]?(\([^)]*\))? project bootstrapped with/i, 'Next.js'],
  [/This is an \[?Expo\]?(\([^)]*\))? project created with/i, 'Expo'],
  [/This template provides a minimal setup to get React working in Vite/i, 'Vite'],
  [/This template should help get you started developing with (Tauri|Vue|Svelte)/i, 'a starter template'],
];

/** The tool whose starter README this still is (e.g. "Lovable"), or null. */
export function templateReadme(markdown: string): string | null {
  for (const [re, tool] of TEMPLATE_READMES) if (re.test(markdown)) return tool;
  return null;
}

/** Paragraphs that are present but aren't a description of the project. */
function notADescription(lines: string[]): boolean {
  // A bare file path or URL (e.g. a README that starts with its own path).
  if (lines.length === 1 && /^([a-z]:[\\/]|\/|https?:\/\/)\S*$/i.test(lines[0])) return true;
  // Status / metadata lines: "**Stage:** beta", "**URL**: https://…".
  if (lines.every((l) => /^(\*\*|__)[^*_]{1,40}(:\s*(\*\*|__)|(\*\*|__)\s*:)/.test(l))) return true;
  // A navigation line: only links and separators ("**[Why](#why)** · **[Start](#start)**").
  const links = lines.join(' ').match(/\[[^\]]*\]\([^)]*\)/g) || [];
  if (links.length >= 2 && lines.join(' ').replace(/\[[^\]]*\]\([^)]*\)/g, '').replace(/[\s*_·•|/,–—-]/g, '') === '') return true;
  // A short bold line used as a heading ("**Use your preferred IDE**").
  if (lines.length === 1 && /^(\*\*|__).*(\*\*|__)$/.test(lines[0]) && plainInline(lines[0]).split(' ').length < 6) return true;
  return false;
}

/**
 * The first prose paragraph of a README: skips frontmatter, headings, badges, HTML blocks, images,
 * code, tables, lists, quotes, rules, metadata lines and bare paths. Returns null when the README has no
 * such paragraph, or when it reaches a tool's starter text first.
 */
export function readmeSummary(markdown: string): string | null {
  let text = markdown.replace(/^﻿/, '');
  text = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  const lines = text.split(/\r?\n/);
  let inFence = false;
  let para: string[] = [];
  let hitTemplate = false;
  let sections = 0;
  const flush = (): string | null => {
    if (para.length === 0) return null;
    const lines = para;
    para = [];
    const joined = plainInline(lines.join(' '));
    if (templateReadme(joined)) {
      hitTemplate = true;
      return null;
    }
    if (notADescription(lines)) return null;
    // A paragraph that's only leftover punctuation or a few characters isn't a description.
    return joined.replace(/[^\p{L}\p{N}]/gu, '').length >= 12 ? joined : null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      para = [];
      continue;
    }
    if (inFence) continue;
    const skip =
      line === '' ||
      /^#{1,6}\s/.test(line) ||
      /^(=+|-+)$/.test(line) || // setext underline
      /^<\/?[a-zA-Z][^>]*>?/.test(line) ||
      /^!?\[!\[/.test(line) || // linked badge
      /^!\[/.test(line) ||
      /^\|/.test(line) ||
      /^([-*+]|\d+[.)])\s/.test(line) ||
      /^>/.test(line) ||
      /^([-*_]\s*){3,}$/.test(line);
    if (skip) {
      const done = flush();
      if (done) return clip(done);
      if (hitTemplate) return null;
      // The intro is over by the third "##" section: text deeper down is detail, not a description.
      if (/^##\s/.test(line) && ++sections >= 3) return null;
      continue;
    }
    // A line made only of badges ([![x](..)](..) [![y](..)](..)) is decoration.
    if (plainInline(line) === '') continue;
    para.push(line);
  }
  const last = flush();
  return last ? clip(last) : null;
}

/** README paragraph first (it's what people read), then a manifest description. */
export function describeProject(facts: ProjectBasicsFacts | undefined): ProjectDescription | null {
  if (!facts) return null;
  if (facts.readme) {
    const s = readmeSummary(facts.readme.text);
    if (s) return { text: s, source: facts.readme.path };
  }
  for (const m of facts.manifestDescriptions) {
    const t = plainInline(m.text);
    if (t.length >= 8) return { text: clip(t), source: m.source };
  }
  return null;
}

/** Description from package.json, Cargo.toml or pyproject.toml text (simple, dependency-free parsing). */
export function manifestDescription(file: string, content: string): string | null {
  if (file.endsWith('package.json')) {
    try {
      const d = JSON.parse(content)?.description;
      return typeof d === 'string' && d.trim() ? d.trim() : null;
    } catch {
      return null;
    }
  }
  if (file.endsWith('.toml')) {
    // The description key inside [package] (Cargo) or [project] / [tool.poetry] (Python).
    const sections = file.endsWith('Cargo.toml') ? ['package'] : ['project', 'tool.poetry'];
    let current = '';
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      const sec = /^\[([^\]]+)\]$/.exec(line);
      if (sec) {
        current = sec[1].trim();
        continue;
      }
      if (!sections.includes(current)) continue;
      const m = /^description\s*=\s*(["'])(.*)\1\s*(#.*)?$/.exec(line);
      if (m && m[2].trim()) return m[2].trim();
    }
  }
  return null;
}

/** Licence kind from a LICENSE file's text. */
export function licenceKind(text: string): string | undefined {
  const t = text.slice(0, 4000).toUpperCase();
  if (t.includes('GNU AFFERO GENERAL PUBLIC LICENSE')) return 'AGPL-3.0';
  if (t.includes('GNU LESSER GENERAL PUBLIC LICENSE')) return 'LGPL';
  if (t.includes('GNU GENERAL PUBLIC LICENSE')) return 'GPL';
  if (t.includes('MOZILLA PUBLIC LICENSE')) return 'MPL-2.0';
  if (t.includes('APACHE LICENSE')) return 'Apache-2.0';
  if (t.includes('MIT LICENSE') || t.includes('PERMISSION IS HEREBY GRANTED, FREE OF CHARGE')) return 'MIT';
  if (t.includes('BSD')) return 'BSD';
  if (t.includes('THIS IS FREE AND UNENCUMBERED SOFTWARE')) return 'Unlicense';
  if (t.includes('ALL RIGHTS RESERVED')) return 'Proprietary';
  return undefined;
}

/** Host shown for a remote URL, e.g. "github.com". */
export function remoteHost(url: string): string {
  const scp = /^[\w.-]+@([^:/]+):/.exec(url);
  if (scp) return scp[1].toLowerCase();
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

/** "owner/repo" for a GitHub remote, else null. */
export function githubSlug(url: string): string | null {
  if (remoteHost(url) !== 'github.com') return null;
  const m = /github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
  return m ? `${m[1]}/${m[2]}` : null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function assessProjectBasics(facts: ProjectBasicsFacts | undefined): BasicsReport {
  if (!facts) return { level: 'unknown', checks: [], passed: 0, description: null };
  const description = describeProject(facts);
  const checks: BasicsCheck[] = [];
  const readmeDesc = facts.readme ? readmeSummary(facts.readme.text) : null;

  checks.push(
    !facts.readme
      ? {
          id: 'readme',
          label: 'README',
          status: 'fail',
          chip: 'No README',
          required: true,
          detail: description
            ? `No README. ${description.source} says: “${description.text}”`
            : 'No README, so nothing says what this project is.',
        }
      : !readmeDesc
        ? templateReadme(facts.readme.text)
          ? {
              id: 'readme',
              label: 'README',
              status: 'warn',
              chip: 'Template README',
              required: true,
              detail: `${facts.readme.path} is still the ${templateReadme(facts.readme.text)} starter text: it doesn't say what this project is.`,
            }
          : {
              id: 'readme',
              label: 'README',
              status: 'warn',
              chip: 'No description',
              required: true,
              detail: `${facts.readme.path} has no opening paragraph saying what the project is.`,
            }
        : { id: 'readme', label: 'README', status: 'pass', required: true, detail: `${facts.readme.path} describes the project.` }
  );

  const repos = facts.repos;
  const nestedNote = repos.length > 0 && repos[0].path !== '' ? ` (in ${repos.map((r) => `${r.path}/`).join(', ')})` : '';
  if (repos.length === 0) {
    checks.push({ id: 'git', label: 'Git', status: 'fail', chip: 'No git', required: true, detail: 'Not a git repository: changes have no history.' });
  } else if (repos.every((r) => r.error)) {
    checks.push({ id: 'git', label: 'Git', status: 'warn', required: true, detail: `Git could not be read: ${repos[0].error}` });
  } else {
    checks.push({ id: 'git', label: 'Git', status: 'pass', required: true, detail: `Git repository${nestedNote}.` });
  }

  const readable = repos.filter((r) => !r.error);
  if (readable.length > 0) {
    const noRemote = readable.filter((r) => r.remotes.length === 0);
    const hosts = [...new Set(readable.flatMap((r) => r.remotes.map((x) => remoteHost(x.url))))];
    if (noRemote.length > 0) {
      checks.push({
        id: 'remote',
        label: 'Remote',
        status: 'fail',
        chip: 'Local only',
        required: true,
        detail: `No remote${noRemote[0].path ? ` for ${noRemote.map((r) => `${r.path}/`).join(', ')}` : ''}: the only copy is on this PC.`,
      });
    } else if (!hosts.includes('github.com')) {
      checks.push({ id: 'remote', label: 'Remote', status: 'pass', required: true, detail: `Remote on ${hosts.join(', ')} (not GitHub).` });
    } else {
      const slugs = readable.flatMap((r) => r.remotes.map((x) => githubSlug(x.url)).filter(Boolean));
      checks.push({ id: 'remote', label: 'Remote', status: 'pass', required: true, detail: `On GitHub: ${[...new Set(slugs)].join(', ')}.` });
    }

    const problems: string[] = [];
    let chip: string | undefined;
    for (const r of readable) {
      const where = r.path ? `${r.path}/: ` : '';
      if (!r.hasCommits) {
        problems.push(`${where}nothing committed yet`);
        chip ??= 'No commits';
      } else if (r.remotes.length > 0 && !r.upstream) {
        problems.push(`${where}branch ${r.branch || '(detached)'} was never pushed`);
        chip ??= 'Not pushed';
      } else if (r.ahead > 0) {
        problems.push(`${where}${plural(r.ahead, 'commit')} not pushed`);
        chip ??= `${r.ahead} unpushed`;
      }
      if (r.behind > 0) problems.push(`${where}${r.behind} behind ${r.upstream} (as of the last fetch)`);
      if (r.dirty > 0) {
        problems.push(`${where}${plural(r.dirty, 'file')} with uncommitted changes`);
        chip ??= 'Uncommitted';
      }
    }
    const remoteless = readable.every((r) => r.remotes.length === 0);
    checks.push(
      problems.length === 0
        ? { id: 'pushed', label: 'Pushed', status: 'pass', required: false, detail: remoteless ? 'All work committed.' : 'Everything committed and pushed.' }
        : { id: 'pushed', label: 'Pushed', status: 'warn', chip, required: false, detail: problems.join('; ') + '.' }
    );
  }

  const tracked = readable.flatMap((r) => (r.trackedSecrets || []).map((p) => (r.path ? `${r.path}/${p}` : p)));
  if (tracked.length > 0) {
    checks.push({
      id: 'secrets',
      label: 'Secrets in git',
      status: 'fail',
      chip: 'Secrets in git',
      required: true,
      detail: `Committed: ${tracked.slice(0, 5).join(', ')}${tracked.length > 5 ? ', …' : ''}. Anyone with the repository can read them. Stop tracking them, and replace any keys that were ever pushed.`,
    });
  }

  const gaps = facts.gitignoreGaps || [];
  checks.push(
    facts.gitignore && gaps.length > 0
      ? {
          id: 'gitignore',
          label: '.gitignore',
          status: 'warn',
          chip: gaps.includes('.env') ? '.env not ignored' : gaps.some((l) => l.startsWith('.env')) ? 'Env file not ignored' : '.gitignore gaps',
          required: false,
          detail: `Doesn't keep out: ${gaps.join(', ')}.${gaps.some((l) => l.startsWith('.env')) ? ' Env files usually hold keys.' : ''}`,
        }
      : facts.gitignore
      ? { id: 'gitignore', label: '.gitignore', status: 'pass', required: false, detail: 'Keeps .env files, keys and build folders out of git.' }
      : {
          id: 'gitignore',
          label: '.gitignore',
          status: 'warn',
          chip: 'No .gitignore',
          required: false,
          detail: 'No .gitignore: node_modules, builds or .env files could end up in git.',
        }
  );

  checks.push(
    facts.licence
      ? {
          id: 'licence',
          label: 'Licence',
          status: 'pass',
          required: false,
          detail: `${facts.licence.kind || 'Licence'}${facts.licence.file ? ` (${facts.licence.file})` : ' (package.json)'}.`,
        }
      : { id: 'licence', label: 'Licence', status: 'warn', chip: 'No licence', required: false, detail: 'No LICENSE file.' }
  );

  const level: BasicsLevel = checks.some((c) => c.required && c.status === 'fail')
    ? 'missing'
    : checks.some((c) => c.status !== 'pass')
      ? 'partial'
      : 'complete';
  return { level, checks, passed: checks.filter((c) => c.status === 'pass').length, description };
}

/** Parses `git status --porcelain=v2 --branch` output into branch, upstream, ahead/behind and dirty count. */
export function parseStatusV2(out: string): Pick<RepoFacts, 'branch' | 'hasCommits' | 'upstream' | 'ahead' | 'behind' | 'dirty'> {
  let branch: string | undefined;
  let hasCommits = true;
  let upstream: string | undefined;
  let ahead = 0;
  let behind = 0;
  let dirty = 0;
  for (const line of out.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('# branch.oid ')) hasCommits = line.slice(13).trim() !== '(initial)';
    else if (line.startsWith('# branch.head ')) {
      const h = line.slice(14).trim();
      branch = h === '(detached)' ? undefined : h;
    } else if (line.startsWith('# branch.upstream ')) upstream = line.slice(18).trim();
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        ahead = Number(m[1]);
        behind = Number(m[2]);
      }
    } else if (!line.startsWith('#')) dirty++;
  }
  return { branch, hasCommits, upstream, ahead, behind, dirty };
}

/** Parses `git remote -v` into unique {name, url} (fetch URLs). */
export function parseRemotes(out: string): Array<{ name: string; url: string }> {
  const seen = new Map<string, string>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
    if (m && !seen.has(m[1])) seen.set(m[1], m[2]);
  }
  return [...seen].map(([name, url]) => ({ name, url }));
}
