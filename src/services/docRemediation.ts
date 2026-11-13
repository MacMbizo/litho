/**
 * DocAtlas safe-remediation primitives.
 *
 * Pure functions (no I/O) that compute the new content of a document for each DocPassport action,
 * so the UI layer only has to persist the result. Every link written here is relative to the file
 * that contains it, so remediation never introduces broken links.
 */
import type { DocumentMetadata, MarkdownFile } from '../types/document';
import type { DetectedStackProfile } from '../types/docAudit';
import { DEV_SERVER_PORTS, extractRelativeMarkdownLinks, resolveRelativeDocPath } from './docHealthAuditor';

export const ARCHIVE_DIR = '_archive';

/** Percent-encodes a path for use as a markdown link target (spaces, parentheses, etc.). */
export function encodeLinkPath(p: string): string {
  return p
    .split('/')
    .map((seg) => (seg === '..' || seg === '.' ? seg : encodeURIComponent(seg).replace(/\(/g, '%28').replace(/\)/g, '%29')))
    .join('/');
}

/** Link target that reaches `toPath` from a document at `fromPath` (both project-root relative). */
export function relativeLinkPath(fromPath: string, toPath: string): string {
  const fromDir = fromPath.split('/').slice(0, -1);
  const toParts = toPath.split('/');
  let common = 0;
  while (common < fromDir.length && common < toParts.length - 1 && fromDir[common] === toParts[common]) common++;
  const ups = new Array(fromDir.length - common).fill('..');
  return encodeLinkPath([...ups, ...toParts.slice(common)].join('/'));
}

export function todayIso(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Rewrites drifted dev-server ports and Expo SDK references to match the project config.
 * Database/service ports (5432, 6379, 54321...) are never touched.
 */
export function applyDriftFixes(
  body: string,
  stack: Pick<DetectedStackProfile, 'localPort' | 'expoSdkVersion'>
): { body: string; changes: string[] } {
  const changes = new Set<string>();
  let next = body;

  if (stack.localPort) {
    const target = stack.localPort;
    next = next.replace(/\b(localhost|127\.0\.0\.1):(\d{2,5})\b/g, (match, host: string, portStr: string) => {
      const port = Number(portStr);
      if (port === target || !DEV_SERVER_PORTS.includes(port)) return match;
      changes.add(`localhost:${port} → localhost:${target}`);
      return `${host}:${target}`;
    });
  }

  const sdkMajor = stack.expoSdkVersion ? parseInt(stack.expoSdkVersion, 10) : NaN;
  if (!Number.isNaN(sdkMajor)) {
    next = next.replace(/\bExpo(\s+)SDK(\s*)(\d{2})\b/gi, (match, s1: string, s2: string, ver: string) => {
      if (Number(ver) === sdkMajor) return match;
      changes.add(`Expo SDK ${ver} → Expo SDK ${sdkMajor}`);
      return `Expo${s1}SDK${s2 || ' '}${sdkMajor}`;
    });
  }

  return { body: next, changes: Array.from(changes) };
}

const DEPRECATION_BANNER_RE = /^>\s*\[!(?:WARNING|CAUTION)\]\s*\*\*Deprecated:\*\*[^\n]*\n(?:>[^\n]*\n)*\n*/im;

/** Non-destructive in-place deprecation: banner + `status: Archived`, path unchanged. */
export function deprecateInPlace(
  file: Pick<MarkdownFile, 'path' | 'frontmatter' | 'body'>,
  supersededByPath: string | undefined,
  today = todayIso()
): { frontmatter: DocumentMetadata; body: string } {
  const frontmatter: DocumentMetadata = { ...file.frontmatter, status: 'Archived', updated_at: today };
  if (/\*\*Deprecated:\*\*/.test(file.body.slice(0, 600))) {
    return { frontmatter, body: file.body };
  }
  const banner =
    supersededByPath && supersededByPath !== file.path
      ? `> [!WARNING] **Deprecated:** Superseded by [${supersededByPath}](${relativeLinkPath(file.path, supersededByPath)}).`
      : '> [!WARNING] **Deprecated:** This document is no longer maintained.';
  return { frontmatter, body: `${banner}\n\n${file.body.trimStart()}` };
}

/** Reverses `deprecateInPlace`: removes the banner and sets `status: Active`. */
export function restoreActive(
  file: Pick<MarkdownFile, 'frontmatter' | 'body'>,
  today = todayIso()
): { frontmatter: DocumentMetadata; body: string } {
  const frontmatter: DocumentMetadata = { ...file.frontmatter, status: 'Active', updated_at: today };
  delete frontmatter.deprecated;
  return { frontmatter, body: file.body.replace(DEPRECATION_BANNER_RE, '').trimStart() };
}

/**
 * Adds `targetPath` to the README's `## Documentation` section (creating it if needed).
 * Returns the new README body, or null when the README already links to the target.
 */
export function adoptIntoReadme(
  readme: Pick<MarkdownFile, 'path' | 'body'>,
  targetPath: string,
  title: string
): string | null {
  const alreadyLinked = extractRelativeMarkdownLinks(readme.body).some(
    (l) => resolveRelativeDocPath(readme.path, l).toLowerCase() === targetPath.toLowerCase()
  );
  if (alreadyLinked) return null;

  const safeTitle = title.replace(/([[\]])/g, '\\$1');
  const line = `- [${safeTitle}](${relativeLinkPath(readme.path, targetPath)})`;
  const body = readme.body;
  const heading = /^##\s+Documentation\s*$/im.exec(body);
  if (!heading) {
    return `${body.trimEnd()}\n\n## Documentation\n\n${line}\n`;
  }
  const sectionStart = heading.index + heading[0].length;
  const nextHeading = /^#{1,2}\s/m.exec(body.slice(sectionStart));
  const sectionEnd = nextHeading ? sectionStart + nextHeading.index : body.length;
  const section = body.slice(sectionStart, sectionEnd).replace(/\s+$/, '');
  const after = body.slice(sectionEnd);
  return `${body.slice(0, sectionStart)}${section ? `${section}\n` : '\n\n'}${line}\n${after ? `\n${after}` : ''}`;
}

/** Rewrites the relative links inside a document so they still resolve after it moves. */
export function rewriteRelativeLinksForMove(body: string, oldPath: string, newPath: string): string {
  return body.replace(
    /(!?\[[^\]]*\]\()(<[^>]+>|[^)\s]+)((?:\s+"[^"]*")?\))/g,
    (match, open: string, rawTarget: string, close: string) => {
      const target = rawTarget.startsWith('<') ? rawTarget.slice(1, -1) : rawTarget;
      if (!target || target.startsWith('#') || target.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
        return match;
      }
      const hashIdx = target.indexOf('#');
      const pathPart = hashIdx === -1 ? target : target.slice(0, hashIdx);
      const hash = hashIdx === -1 ? '' : target.slice(hashIdx);
      let decoded = pathPart;
      try {
        decoded = decodeURIComponent(pathPart);
      } catch {
        // keep raw
      }
      const absolute = resolveRelativeDocPath(oldPath, decoded);
      return `${open}${relativeLinkPath(newPath, absolute)}${hash}${close}`;
    }
  );
}

export function archivePathFor(path: string): string {
  return `${ARCHIVE_DIR}/${path.replace(/^_archive\//i, '')}`;
}

/** Original location of an archived file, or null if it is not inside `_archive/`. */
export function restorePathFor(path: string): string | null {
  return /^_archive\//i.test(path) ? path.replace(/^_archive\//i, '') : null;
}
