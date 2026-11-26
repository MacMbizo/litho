/**
 * DocAtlas's audit of a project, as a short plain-text brief for the AI's thinker: what the project is,
 * how healthy its docs are, which docs are authoritative or suspect, and whether its stack still runs.
 * Pure, so it's tested without the app. Kept short (a few hundred words): it goes into every question.
 */
import type { ProjectDocAuditReport, StackFreshnessReport } from '../types/docAudit';
import type { BasicsReport } from './projectBasics';

const list = (items: string[], max: number) => (items.length > max ? `${items.slice(0, max).join(', ')}, and ${items.length - max} more` : items.join(', '));

export function projectFactsForAI(input: {
  name: string;
  report?: ProjectDocAuditReport | null;
  freshness?: StackFreshnessReport | null;
  basics?: BasicsReport | null;
}): string {
  const { report, freshness, basics } = input;
  const lines: string[] = [];
  const about = basics?.description?.text;
  lines.push(`- Project: ${input.name}${about ? `: ${about}` : ''}`);

  if (report && report.inventory.length) {
    const c = report.counts;
    const counted = (Object.entries(c) as Array<[string, number]>).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
    lines.push(`- Doc health: grade ${report.grade} (${report.healthScore}/100), ${report.inventory.length} docs: ${counted.join(', ')}.`);
    const key = report.inventory
      .filter((d) => d.status === 'canonical')
      .sort((a, b) => b.canonicalScore - a.canonicalScore)
      .map((d) => d.path);
    if (key.length) lines.push(`- Authoritative docs: ${list(key, 8)}.`);
    const stale = report.inventory.filter((d) => d.status === 'stale').map((d) => d.path);
    if (stale.length) lines.push(`- Stale docs (likely out of date): ${list(stale, 8)}.`);
    const dupes = report.inventory.filter((d) => d.status === 'duplicate').map((d) => (d.duplicateOf ? `${d.path} (copy of ${d.duplicateOf})` : d.path));
    if (dupes.length) lines.push(`- Duplicates: ${list(dupes, 6)}.`);
    const deprecated = report.inventory.filter((d) => d.status === 'deprecated').map((d) => d.path);
    if (deprecated.length) lines.push(`- Deprecated docs: ${list(deprecated, 6)}.`);
    const broken = report.inventory.filter((d) => d.brokenLinks.length).map((d) => d.path);
    if (broken.length) lines.push(`- Broken links in: ${list(broken, 6)}.`);
    const missing = report.missingDocs.filter((m) => m.priority !== 'optional').map((m) => `${m.title} (${m.priority})`);
    if (missing.length) lines.push(`- Missing docs: ${list(missing, 6)}.`);
  } else if (report) {
    lines.push('- Doc health: no Markdown docs found.');
  }

  const stack = report?.stackProfile;
  if (stack && (stack.frameworks.length || stack.expoSdkVersion || stack.packageManager)) {
    const bits = [stack.frameworks.length ? stack.frameworks.join(', ') : '', stack.expoSdkVersion ? `Expo SDK ${stack.expoSdkVersion}` : '', stack.packageManager ? `${stack.packageManager}` : '']
      .filter(Boolean)
      .join('; ');
    lines.push(`- Stack: ${bits}.`);
  }
  if (freshness && freshness.level !== 'none') {
    const top = freshness.issues
      .filter((i) => i.severity !== 'minor')
      .slice(0, 3)
      .map((i) => i.title);
    lines.push(`- Stack freshness: ${freshness.headline}${freshness.score !== null ? ` (${freshness.score}/100)` : ''}${top.length ? `. Top issues: ${top.join('; ')}` : ''}.`);
  }
  if (basics && basics.checks.length) {
    const failing = basics.checks.filter((c) => c.status !== 'pass').map((c) => c.chip || c.label);
    lines.push(`- Project basics: ${failing.length ? `missing or weak: ${failing.join(', ')}` : 'README, git, remote and licence all in place'}.`);
  }
  return lines.join('\n');
}
