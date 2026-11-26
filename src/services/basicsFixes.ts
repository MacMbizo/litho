/**
 * Pure helpers behind the project-basics fixes: the README draft, inserting a description into an
 * existing README, a stack-aware .gitignore, and the secret scan that guards every first commit and push.
 */

export type BasicsAction =
  | { kind: 'create-readme'; content: string }
  | { kind: 'add-description'; readmePath: string; expected: string; description: string }
  /** ignore: extra paths to add to .gitignore first ("Leave out of git"); confirmed: name-only flags the person checked. */
  | { kind: 'start-git'; ignore?: string[]; confirmed?: string[] }
  | { kind: 'publish-github'; repoPath: string; name: string; visibility: 'private' | 'public'; description?: string; confirmed?: string[] }
  | { kind: 'push'; repoPath: string; confirmed?: string[] }
  | { kind: 'add-licence'; repoPath: string; licence: LicenceId; holder: string; year: number }
  /** Append the missing safety lines to an existing .gitignore. */
  | { kind: 'update-gitignore'; repoPath: string }
  /** Stop tracking committed secret files: .gitignore + git rm --cached + one commit. History keeps them. */
  | { kind: 'untrack-secrets'; repoPath: string; paths: string[] };

/** Licences DocAtlas can add. AGPL-3.0 is the owner's default; Proprietary suits client work. */
export const LICENCES = [
  { id: 'AGPL-3.0', github: 'agpl-3.0', label: 'AGPL-3.0', note: 'Open source; changes must stay open, including when run as a web service.' },
  { id: 'GPL-3.0', github: 'gpl-3.0', label: 'GPL-3.0', note: 'Open source; changes must stay open when distributed.' },
  { id: 'MIT', github: 'mit', label: 'MIT', note: 'Permissive: anyone may use it, even in closed products.' },
  { id: 'Apache-2.0', github: 'apache-2.0', label: 'Apache-2.0', note: 'Permissive, with an explicit patent grant.' },
  { id: 'MPL-2.0', github: 'mpl-2.0', label: 'MPL-2.0', note: 'Changed files stay open; the rest can be closed.' },
  { id: 'Proprietary', github: null, label: 'Proprietary', note: 'All rights reserved: for client or private work.' },
] as const;
export type LicenceId = (typeof LICENCES)[number]['id'];

/** The text written to LICENSE, from GitHub's official template (null for Proprietary). */
export function licenceText(id: LicenceId, template: string | null, holder: string, year: number): string {
  if (id === 'Proprietary' || template === null) {
    return `Copyright (c) ${year} ${holder}. All rights reserved.\n\nThis software and its source code are proprietary and confidential. No part of it may be copied, modified, distributed or used without the prior written permission of the copyright holder.\n`;
  }
  // MIT (and BSD-style) templates carry [year] and [fullname]; the GPL family has no fill-ins in its text.
  const text = template.replace(/\[year\]/g, String(year)).replace(/\[fullname\]/g, holder);
  return text.endsWith('\n') ? text : text + '\n';
}

export interface ScanFinding {
  path: string;
  reason: string;
  /** block: a key or env file, never let through. review: only the name is suspicious; the person decides. */
  level: 'block' | 'review';
}

export interface BasicsActionResult {
  ok: boolean;
  /** One plain sentence for the person. */
  message: string;
  /** Why it was refused (secrets, big files), when blocked. */
  findings?: ScanFinding[];
  /** e.g. the GitHub URL after publishing. */
  url?: string;
  /** Files the action wrote, relative to the project. */
  wrote?: string[];
}

// --- validation (main re-checks everything the renderer sends) --------------

export const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

export function validateAction(raw: unknown): BasicsAction {
  const a = raw as Record<string, unknown>;
  if (!a || typeof a !== 'object') throw new Error('Invalid action');
  const str = (v: unknown, max: number, name: string): string => {
    if (typeof v !== 'string' || v.length > max) throw new Error(`Invalid ${name}`);
    return v;
  };
  const relPath = (v: unknown, name: string): string => {
    const s = str(v, 260, name).replace(/\\/g, '/');
    if (s.startsWith('/') || /^[a-z]:/i.test(s) || s.split('/').includes('..')) throw new Error(`Invalid ${name}`);
    return s.replace(/\/+$/, '');
  };
  const relPaths = (v: unknown, name: string): string[] | undefined => {
    if (v == null) return undefined;
    if (!Array.isArray(v) || v.length > 500) throw new Error(`Invalid ${name}`);
    const out = v.map((p) => relPath(p, name));
    // A .gitignore line is a pattern: refuse anything that could reshape the file (newlines, negation, comments).
    if (out.some((p) => !p || /[\r\n]/.test(p) || p.startsWith('!') || p.startsWith('#'))) throw new Error(`Invalid ${name}`);
    return out;
  };
  const optConfirmed = () => {
    const confirmed = relPaths(a.confirmed, 'checked files');
    return confirmed?.length ? { confirmed } : {};
  };
  switch (a.kind) {
    case 'create-readme':
      return { kind: 'create-readme', content: str(a.content, 200_000, 'README') };
    case 'add-description': {
      const description = oneLine(str(a.description, 1000, 'description'));
      if (!description) throw new Error('Description is empty');
      const readmePath = relPath(a.readmePath, 'README path');
      if (!/^readme(\.(md|markdown|mdx|txt))?$/i.test(readmePath.split('/').pop() || '')) throw new Error('Not a README');
      return { kind: 'add-description', readmePath, expected: str(a.expected, 2_000_000, 'README'), description };
    }
    case 'start-git': {
      const ignore = relPaths(a.ignore, 'paths to leave out');
      const confirmed = relPaths(a.confirmed, 'checked files');
      return { kind: 'start-git', ...(ignore?.length ? { ignore } : {}), ...(confirmed?.length ? { confirmed } : {}) };
    }
    case 'update-gitignore':
      return { kind: 'update-gitignore', repoPath: relPath(a.repoPath ?? '', 'repo path') };
    case 'untrack-secrets': {
      const paths = relPaths(a.paths, 'files') || [];
      if (paths.length === 0) throw new Error('No files given');
      return { kind: 'untrack-secrets', repoPath: relPath(a.repoPath ?? '', 'repo path'), paths };
    }
    case 'publish-github': {
      const name = str(a.name, 100, 'repository name');
      if (!REPO_NAME_RE.test(name)) throw new Error('Repository names may use letters, numbers, ".", "-" and "_" only');
      if (a.visibility !== 'private' && a.visibility !== 'public') throw new Error('Invalid visibility');
      const description = a.description == null ? undefined : oneLine(str(a.description, 1000, 'description')).slice(0, 350);
      return {
        kind: 'publish-github',
        repoPath: relPath(a.repoPath ?? '', 'repo path'),
        name,
        visibility: a.visibility,
        description: description || undefined,
        ...optConfirmed(),
      };
    }
    case 'push':
      return { kind: 'push', repoPath: relPath(a.repoPath ?? '', 'repo path'), ...optConfirmed() };
    case 'add-licence': {
      const licence = LICENCES.find((l) => l.id === a.licence)?.id;
      if (!licence) throw new Error('Unknown licence');
      const holder = oneLine(str(a.holder, 200, 'copyright holder'));
      if (!holder) throw new Error('Who holds the copyright?');
      const year = Number(a.year);
      if (!Number.isInteger(year) || year < 1970 || year > 2200) throw new Error('Invalid year');
      return { kind: 'add-licence', repoPath: relPath(a.repoPath ?? '', 'repo path'), licence, holder, year };
    }
    default:
      throw new Error('Unknown action');
  }
}

export function oneLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A GitHub-safe repository name from a folder name ("Back Cement" → "Back-Cement"). */
export function suggestRepoName(folder: string): string {
  return folder.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'project';
}

// --- README ------------------------------------------------------------------

export interface ReadmeDraftInput {
  name: string;
  description: string;
  frameworks: string[];
  scripts: Record<string, string>;
  packageManager?: string;
  licence?: string;
}

export function draftReadme(i: ReadmeDraftInput): string {
  const pm = i.packageManager && ['npm', 'pnpm', 'yarn', 'bun'].includes(i.packageManager) ? i.packageManager : 'npm';
  const run = (s: string) => (pm === 'npm' ? (s === 'start' || s === 'test' ? `npm ${s}` : `npm run ${s}`) : `${pm} ${s}`);
  const out: string[] = [`# ${i.name}`, '', oneLine(i.description) || '_One or two sentences on what this project does and who it is for._', ''];
  const fw = i.frameworks.filter((f) => f !== 'TypeScript').concat(i.frameworks.includes('TypeScript') ? ['TypeScript'] : []);
  if (fw.length) out.push('## Stack', '', ...fw.map((f) => `- ${f}`), '');
  const scripts = ['dev', 'start', 'build', 'test'].filter((s) => i.scripts[s]);
  if (Object.keys(i.scripts).length || scripts.length) {
    out.push('## Getting started', '', '```bash', `${pm} install`, ...scripts.map(run), '```', '');
  }
  if (i.licence) out.push('## Licence', '', `${i.licence}. See [LICENSE](LICENSE).`, '');
  return out.join('\n');
}

/**
 * Puts a description paragraph under the README's title (after frontmatter and any badge/HTML lines
 * right below it), or at the top when there's no title. Keeps the file's line endings.
 */
export function insertDescription(markdown: string, description: string): string {
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/);
  let i = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) i = end + 1;
  }
  while (i < lines.length && lines[i].trim() === '') i++;
  let insertAt = i;
  if (/^#\s/.test(lines[i] || '')) insertAt = i + 1;
  else if (lines[i] && /^=+\s*$/.test(lines[i + 1] || '')) insertAt = i + 2;
  if (insertAt > i) {
    // Step over badges / HTML / blank lines that sit directly under the title.
    let j = insertAt;
    while (j < lines.length && (lines[j].trim() === '' || /^(\[!\[|!\[|<)/.test(lines[j].trim()))) j++;
    if (lines.slice(insertAt, j).some((l) => l.trim() !== '')) insertAt = j;
  }
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  while (before.length && before[before.length - 1].trim() === '') before.pop();
  while (after.length && after[0].trim() === '') after.shift();
  const para = oneLine(description);
  return [...before, ...(before.length ? [''] : []), para, '', ...after].join(eol);
}

// --- .gitignore ---------------------------------------------------------------

export function gitignoreFor(stack: { node?: boolean; python?: boolean; rust?: boolean; dotnet?: boolean }): string {
  const parts: string[][] = [
    ['# Secrets: never commit these', '.env', '.env.*', '!.env.example', '!.env.sample', '!.env.template', '*.pem', '*.key', ''],
    ['# OS and editors', '.DS_Store', 'Thumbs.db', '.vscode/*', '!.vscode/extensions.json', '.idea/', '*.log', ''],
  ];
  if (stack.node) parts.push(['# Node', 'node_modules/', 'dist/', 'build/', '.next/', '.expo/', '.vercel/', 'coverage/', '*.tsbuildinfo', '']);
  if (stack.python) parts.push(['# Python', '__pycache__/', '*.py[cod]', '.venv/', 'venv/', '.pytest_cache/', '.mypy_cache/', '']);
  if (stack.rust) parts.push(['# Rust', 'target/', '']);
  if (stack.dotnet) parts.push(['# .NET', 'bin/', 'obj/', '*.user', '']);
  return parts.flat().join('\n');
}

// --- secret scan ----------------------------------------------------------------

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FILES = 5000;

const RISKY_NAMES: Array<[RegExp, string]> = [
  [/^\.env(\..+)?$/i, 'environment file (usually holds keys)'],
  [/\.(pem|key|p12|pfx|keystore|jks)$/i, 'private key or certificate store'],
  [/^id_(rsa|dsa|ecdsa|ed25519)$/i, 'SSH private key'],
  [/^(credentials|client_secret.*|service[-_]?account.*)\.json$/i, 'cloud credentials'],
  [/^\.(netrc|pgpass)$/i, 'saved passwords'],
];
const SAFE_ENV = /^\.env\.(example|sample|template|defaults?)$/i;

export function riskyFileName(relPath: string): string | null {
  const base = relPath.split('/').pop() || relPath;
  if (SAFE_ENV.test(base)) return null;
  // Android's debug keystore has a public, well-known password; React Native and Expo templates commit it.
  if (/^debug\.keystore$/i.test(base)) return null;
  for (const [re, why] of RISKY_NAMES) if (re.test(base)) return why;
  return null;
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN (RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY( BLOCK)?-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}/, 'GitHub token'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API key'],
  [/\bsk-(proj-)?[A-Za-z0-9_-]{32,}/, 'OpenAI-style API key'],
  [/\b(sk|rk)_live_[0-9A-Za-z]{20,}/, 'Stripe live key'],
  [/\bxox[abprs]-[0-9A-Za-z-]{10,}/, 'Slack token'],
  [/\bnpm_[A-Za-z0-9]{36}\b/, 'npm token'],
  [/_authToken\s*=\s*[^\s$]{8,}/, 'npm auth token'],
  [/\bAccountKey=[A-Za-z0-9+/=]{40,}/, 'Azure storage key'],
];

const PLACEHOLDER = /x{8,}|your[_-]|example|placeholder|<[^>]+>|\$\{/i;

function base64UrlJson(part: string): any {
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(bin);
  } catch {
    return null;
  }
}

/** Connection strings with an inline password, except throwaway local ones (localhost dev databases). */
const DB_URL = /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?):\/\/([^:\s/@'"`]+):([^@\s'"`]{4,})@([^/\s:'"`?]+)/gi;

/** The kind of secret a text file appears to contain, or null. Placeholder values are ignored. */
export function secretInText(text: string): string | null {
  for (const [re, why] of SECRET_PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of text.matchAll(g)) if (!PLACEHOLDER.test(m[0])) return why;
  }
  // Supabase keys are JWTs: "anon" keys are public by design, "service_role" bypasses all security.
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g)) {
    const role = base64UrlJson(m[1])?.role;
    if (role === 'service_role' || role === 'supabase_admin') return 'Supabase service_role key (full database access)';
  }
  if (/\bsb_secret_[A-Za-z0-9_-]{20,}/.test(text)) return 'Supabase secret key';
  for (const m of text.matchAll(DB_URL)) {
    const host = m[4].toLowerCase();
    if (['localhost', '127.0.0.1', '0.0.0.0', 'db', 'postgres', 'mysql', 'mongo', 'redis', 'host.docker.internal'].includes(host)) continue;
    if (PLACEHOLDER.test(m[0]) || /^(password|pass|pwd|secret|changeme)$/i.test(m[3])) continue;
    return 'database URL with a password';
  }
  return null;
}

/** File names that suggest credentials: not proof, so the person checks them (they can be test logins). */
export function reviewFileName(relPath: string): string | null {
  const base = relPath.split('/').pop() || relPath;
  if (riskyFileName(relPath) || SAFE_ENV.test(base)) return null;
  return /(credential|secret|passw(or)?d|api[-_]?keys?)/i.test(base) ? 'its name suggests credentials: check it before it goes into git' : null;
}

/** True when the first bytes look binary (a NUL byte). */
export function looksBinary(head: Uint8Array): boolean {
  return head.subarray(0, 8000).includes(0);
}

// --- .gitignore: read it, and add only what's missing ------------------------------

/** One .gitignore rule, compiled. */
interface IgnoreRule {
  negate: boolean;
  dirOnly: boolean;
  re: RegExp;
}

function compileRule(line: string): IgnoreRule | null {
  let l = line.replace(/\s+$/, '');
  if (!l || l.startsWith('#')) return null;
  const negate = l.startsWith('!');
  if (negate) l = l.slice(1);
  const dirOnly = l.endsWith('/');
  if (dirOnly) l = l.replace(/\/+$/, '');
  // A slash at the start or in the middle anchors the pattern to the .gitignore's folder.
  const anchored = l.includes('/');
  l = l.replace(/^\//, '');
  let src = '';
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (c === '\\' && i + 1 < l.length) {
      // An escaped character is literal ("\[", "\*", "\#", "\!").
      src += l[++i].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    } else if (c === '*') {
      if (l[i + 1] === '*') {
        src += l[i + 2] === '/' ? '(?:.*/)?' : '.*';
        i += l[i + 2] === '/' ? 2 : 1;
      } else src += '[^/]*';
    } else if (c === '?') src += '[^/]';
    else if (c === '[') {
      const end = l.indexOf(']', i + 1);
      if (end > i) {
        src += '[' + l.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\') + ']';
        i = end;
      } else src += '\\[';
    } else src += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return { negate, dirOnly, re: new RegExp(anchored ? `^${src}$` : `^(?:.*/)?${src}$`) };
}

/**
 * Whether a path (relative to the .gitignore's folder, "/"-separated) is ignored. Follows git's rules
 * that matter here: last matching rule wins, "!" re-includes, "dir/" matches folders only, and anything
 * inside an ignored folder is ignored (a "!" can't bring it back).
 */
export function isIgnored(gitignore: string, relPath: string, isDir = false): boolean {
  const rules = gitignore.split(/\r?\n/).map(compileRule).filter((r): r is IgnoreRule => r !== null);
  const parts = relPath.split('/').filter(Boolean);
  for (let i = 1; i <= parts.length; i++) {
    const sub = parts.slice(0, i).join('/');
    const subIsDir = i < parts.length || isDir;
    let ignored = false;
    for (const r of rules) {
      if (r.dirOnly && !subIsDir) continue;
      if (r.re.test(sub)) ignored = !r.negate;
    }
    if (ignored && i < parts.length) return true; // a parent folder is ignored
    if (i === parts.length) return ignored;
  }
  return false;
}

/** Folders that never belong in git when they exist at the top of a project. */
const BUILD_DIRS = ['node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', '.expo', '.turbo', 'target', 'coverage', '.vercel'];

/**
 * Lines to append so .gitignore keeps secrets and build output out of git. Never removes a line;
 * returns [] when nothing is missing. `entries` are the names at the top of the folder.
 */
export function missingIgnoreLines(gitignore: string, entries: Array<{ name: string; isDir: boolean }>): string[] {
  const add: string[] = [];
  const current = () => gitignore + '\n' + add.join('\n');
  if (!isIgnored(current(), '.env')) add.push('.env');
  if (!isIgnored(current(), '.env.local') || !isIgnored(current(), '.env.production')) add.push('.env.*');
  // Example env files are meant to be shared: keep .env.example always, the others when they exist.
  for (const keep of ['.env.example', '.env.sample', '.env.template']) {
    const wanted = keep === '.env.example' || entries.some((e) => e.name === keep);
    if (wanted && isIgnored(current(), keep)) add.push('!' + keep);
  }
  for (const [probe, line] of [['server.pem', '*.pem'], ['server.key', '*.key']] as const) {
    if (!isIgnored(current(), probe)) add.push(line);
  }
  for (const e of entries) {
    if (e.isDir && BUILD_DIRS.includes(e.name) && !isIgnored(current(), e.name, true)) add.push(`${e.name}/`);
  }
  return add;
}

/**
 * The gaps worth a warning in an existing .gitignore: real risks only. A missing ".env" rule always counts
 * (it's the file that leaks keys); ".env.*" only when such a file exists unignored (Next.js commits
 * .env.production on purpose); build folders only when present. Key patterns and "!.env.example" are tidy-ups
 * a fix adds, not warnings.
 */
export function ignoreGaps(gitignore: string, entries: Array<{ name: string; isDir: boolean }>): string[] {
  const gaps: string[] = [];
  if (!isIgnored(gitignore, '.env')) gaps.push('.env');
  const loose = entries.filter((e) => !e.isDir && /^\.env\..+/i.test(e.name) && !SAFE_ENV.test(e.name) && !isIgnored(gitignore, e.name));
  if (loose.length) gaps.push(...loose.map((e) => e.name));
  for (const e of entries) {
    if (e.isDir && BUILD_DIRS.includes(e.name) && !isIgnored(gitignore, e.name, true)) gaps.push(`${e.name}/`);
  }
  return gaps;
}

/** The text appended to an existing .gitignore (keeps its line endings and a trailing newline). */
export function appendIgnoreLines(gitignore: string, lines: string[], heading = '# Added by DocAtlas: keep secrets and build output out of git'): string {
  if (lines.length === 0) return gitignore;
  const eol = gitignore.includes('\r\n') ? '\r\n' : '\n';
  const base = gitignore === '' || gitignore.endsWith('\n') ? gitignore : gitignore + eol;
  return base + (base.trim() ? eol : '') + [heading, ...lines].join(eol) + eol;
}
