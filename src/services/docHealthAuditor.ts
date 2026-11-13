import type { MarkdownFile, ProjectWorkspace } from '../types/document';
import type {
  DetectedStackProfile,
  DocCategory,
  DocInventoryItem,
  DocTaxonomyStatus,
  MissingDocRecommendation,
  ProjectDocAuditReport,
} from '../types/docAudit';

const CANONICAL_TOPICS: Array<{
  id: string;
  fileName: string;
  patterns: RegExp[];
  category: DocCategory;
}> = [
  { id: 'readme', fileName: 'README.md', patterns: [/^readme(\.md|\.mdx)?$/i], category: 'Core Spec' },
  {
    id: 'architecture',
    fileName: 'ARCHITECTURE.md',
    patterns: [/^architecture(\.md)?$/i, /^design(\.md)?$/i, /^system[-_]?design(\.md)?$/i],
    category: 'Architecture',
  },
  { id: 'contributing', fileName: 'CONTRIBUTING.md', patterns: [/^contributing(\.md)?$/i], category: 'Governance' },
  { id: 'security', fileName: 'SECURITY.md', patterns: [/^security(\.md)?$/i], category: 'Governance' },
  { id: 'changelog', fileName: 'CHANGELOG.md', patterns: [/^changelog(\.md)?$/i, /^history(\.md)?$/i], category: 'Core Spec' },
  {
    id: 'deployment',
    fileName: 'DEPLOYMENT.md',
    patterns: [/^deploy(ment)?(\.md)?$/i, /^runbook(\.md)?$/i, /^ops(\.md)?$/i],
    category: 'Operations & Deploy',
  },
  { id: 'api', fileName: 'API.md', patterns: [/^api([-_]?reference|[-_]?docs)?(\.md)?$/i], category: 'Architecture' },
];

function tokenizeNormalizedBody(body: string): Set<string> {
  const cleaned = body
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`_\-\[\]()!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter((w) => w.length >= 3);
  const shingles = new Set<string>();
  if (words.length < 6) {
    for (const w of words) shingles.add(w);
    return shingles;
  }
  for (let i = 0; i <= words.length - 3; i++) {
    shingles.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  return shingles;
}

/** Jaccard similarity (0..1) of 3-word shingles, ignoring code blocks and markdown punctuation. */
export function computeBodySimilarity(bodyA: string, bodyB: string): number {
  const setA = tokenizeNormalizedBody(bodyA);
  const setB = tokenizeNormalizedBody(bodyB);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function getParentDir(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? '' : filePath.slice(0, idx).toLowerCase();
}

function isExplicitCopyName(fileName: string): boolean {
  return /[-_.](copy|backup|bak|dup|duplicate|old|v\d+)\./i.test(fileName);
}

/** Matches `name-copy.md`, `name_backup.md`, `name (1).md`, `name copy.md` and returns the original file name. */
function originalNameForCopy(fileName: string): string | null {
  const m = fileName.match(/^(.+?)(?:[-_. ](?:copy|backup|bak|dup|duplicate|old)(?:[-_ ]?\d+)?| \(\d+\))(\.(?:md|mdx|markdown))$/i);
  return m ? `${m[1]}${m[2]}` : null;
}

/** Removes fenced and inline code so example links inside code are not treated as real links. */
export function stripCode(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\r\n]*`/g, ' ');
}

function safeDecode(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/** Local markdown links, including angle-bracket targets with spaces; decoded; code is ignored. */
export function extractRelativeMarkdownLinks(body: string): string[] {
  const links: string[] = [];
  const regex = /\[[^\]]*\]\((?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g;
  const text = stripCode(body);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const raw = (match[1] || match[2] || '').trim().replace(/#.*$/, '');
    if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) continue;
    if (/\.(md|markdown|mdx)$/i.test(raw)) {
      links.push(safeDecode(raw));
    }
  }
  return links;
}

export function resolveRelativeDocPath(fromFilePath: string, linkTarget: string): string {
  if (linkTarget.startsWith('/')) {
    return linkTarget.replace(/^\/+/, '');
  }
  const parts = fromFilePath.split('/').slice(0, -1);
  for (const seg of linkTarget.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join('/');
}

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_AFTER_DAYS = 180;

/** Well-known local dev-server ports. Database / service ports (5432, 6379, 54321...) are never treated as drift. */
export const DEV_SERVER_PORTS = [3000, 3001, 4000, 4200, 5000, 5173, 5174, 8000, 8080, 8081, 8501, 19000, 19006];

/** Returns the dev-server ports a document mentions that disagree with the configured one. */
export function findPortDrift(body: string, configuredPort?: number): number[] {
  if (!configuredPort) return [];
  const drifted = new Set<number>();
  const re = /(?:localhost|127\.0\.0\.1):(\d{2,5})\b/g;
  let m: RegExpExecArray | null;
  const text = body;
  while ((m = re.exec(text)) !== null) {
    const port = Number(m[1]);
    if (port !== configuredPort && DEV_SERVER_PORTS.includes(port)) drifted.add(port);
  }
  return Array.from(drifted);
}

/** Returns the Expo SDK major a document references when it disagrees with the project, else null. */
export function findExpoSdkDrift(body: string, expoSdkVersion?: string): number | null {
  if (!expoSdkVersion) return null;
  const current = parseInt(expoSdkVersion, 10);
  if (!current) return null;
  const re = /Expo\s+SDK\s*(\d{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (Number(m[1]) !== current) return Number(m[1]);
  }
  return null;
}

/**
 * Documents that are historical records by design (ADRs, RFCs, changelogs, licences) or explicitly
 * marked `evergreen: true` never go stale merely by age.
 */
function isAgeExempt(file: MarkdownFile): boolean {
  if (file.frontmatter.evergreen === true) return true;
  const lowerPath = file.path.toLowerCase();
  const name = lowerPath.split('/').pop() || '';
  if (/(^|\/)(adrs?|decisions|rfcs?)\//.test(lowerPath)) return true;
  if (/^(adr|rfc)[-_ ]?\d+/.test(name) || /^\d{3,4}[-_]/.test(name)) return true;
  return /^(changelog|history|license|licence|code_of_conduct|code-of-conduct|contributing|security|notice)(\.|$)/.test(name);
}

function isInArchiveFolder(filePath: string): boolean {
  return filePath
    .toLowerCase()
    .split('/')
    .slice(0, -1)
    .some((d) => /^_?(archived?|deprecated|legacy|obsolete|old)$/.test(d));
}

function isDeprecatedDoc(file: MarkdownFile): boolean {
  if (file.frontmatter.status === 'Archived' || file.frontmatter.deprecated === true) return true;
  if (isInArchiveFolder(file.path)) return true;
  const segments = file.path.toLowerCase().split('/');
  if (/(^|[-_. ])(deprecated|legacy|obsolete)([-_. ]|$)/.test(segments[segments.length - 1])) return true;
  const head = file.body.slice(0, 400);
  return /^\s*(?:>\s*)?(?:\[![a-z]+\]\s*)?(?:\*\*|__)?\s*(deprecated|obsolete)\b/im.test(head);
}

function detectCategory(file: MarkdownFile): DocCategory {
  const lowerPath = file.path.toLowerCase();
  const lowerName = file.name.toLowerCase();

  if (
    lowerPath.includes('archive') ||
    lowerPath.includes('deprecated') ||
    lowerPath.includes('legacy') ||
    file.frontmatter.status === 'Archived'
  ) {
    return 'Archive';
  }
  if (
    file.frontmatter.type === 'agent' ||
    file.frontmatter.type === 'skill' ||
    lowerName === 'skill.md' ||
    lowerName === 'agents.md' ||
    lowerName === 'claude.md' ||
    lowerPath.includes('/agents/') ||
    lowerPath.includes('/skills/')
  ) {
    return 'Agent / Skill';
  }
  if (lowerName.includes('arch') || lowerName.includes('adr') || lowerName.includes('api') || lowerName.includes('schema')) {
    return 'Architecture';
  }
  if (lowerName.includes('deploy') || lowerName.includes('runbook') || lowerName.includes('setup') || lowerName.includes('docker')) {
    return 'Operations & Deploy';
  }
  if (lowerName.includes('contribut') || lowerName.includes('security') || lowerName.includes('code_of_conduct')) {
    return 'Governance';
  }
  if (lowerName.includes('note') || lowerName.includes('todo') || lowerName.includes('plan') || lowerName.includes('scratch') || lowerName.includes('temp')) {
    return 'Planning / Notes';
  }
  return 'Core Spec';
}

function buildMissingDocRecommendations(
  project: ProjectWorkspace,
  stack: DetectedStackProfile,
  existingTopicIds: Set<string>
): MissingDocRecommendation[] {
  const recs: MissingDocRecommendation[] = [];
  const stackSummary = stack.frameworks.length > 0 ? stack.frameworks.join(', ') : 'TypeScript / Node.js';
  const pm = (stack.packageManager || '').split('@')[0] || 'npm';
  const run = (script: string) => (pm === 'npm' ? (script === 'start' || script === 'test' ? `npm ${script}` : `npm run ${script}`) : `${pm} ${script}`);
  const isPythonOnly = stack.frameworks.includes('Python') && !stack.configFilesFound.includes('package.json');
  const installCmd = isPythonOnly
    ? stack.configFilesFound.includes('requirements.txt')
      ? 'pip install -r requirements.txt'
      : 'pip install -e .'
    : `${pm} install`;
  const devCmd = isPythonOnly
    ? stack.frameworks.includes('Fastapi')
      ? `uvicorn main:app --reload${stack.localPort ? ` --port ${stack.localPort}` : ''}`
      : 'python main.py'
    : stack.scripts.dev
      ? run('dev')
      : stack.scripts.start
        ? run('start')
        : run('dev');
  const testCmd = isPythonOnly ? 'pytest' : stack.scripts.test ? run('test') : `${run('test')}  # add a test script`;

  if (!existingTopicIds.has('readme')) {
    recs.push({
      id: 'readme',
      fileName: 'README.md',
      title: 'Project README & Quick Start',
      priority: 'critical',
      reason: 'Every repository needs a canonical README explaining purpose, setup, and commands.',
      templateContent: `---\ntitle: "${project.name}"\ntype: "project"\nstatus: "Active"\ntags: ["readme", "overview"]\n---\n\n# ${project.name}\n\n> Stack: ${stackSummary}\n\n## Quick Start\n\n\`\`\`bash\n${installCmd}\n${devCmd}\n\`\`\`\n\n## Environment Variables\n\nCopy \`.env.example\` to \`.env\` and configure required credentials.\n\n## Testing\n\n\`\`\`bash\n${testCmd}\n\`\`\`\n`,
    });
  }

  if (!existingTopicIds.has('architecture')) {
    recs.push({
      id: 'architecture',
      fileName: 'ARCHITECTURE.md',
      title: 'System Architecture Spec',
      priority: project.files.length >= 3 || stack.frameworks.length >= 2 ? 'critical' : 'recommended',
      reason: `Documents boundaries, data flow, and ${stackSummary} conventions for future-you and collaborators.`,
      templateContent: `---\ntitle: "${project.name} Architecture"\ntype: "document"\nstatus: "Active"\ntags: ["architecture", "design"]\n---\n\n# System Architecture — ${project.name}\n\n## 1. Tech Stack\n${stack.frameworks.map((f) => `- **${f}**`).join('\n') || '- Core Runtime'}\n\n## 2. Directory Structure\n- \`src/\` — Application source code\n- \`docs/\` — Technical specifications and ADRs\n\n## 3. Data Flow & External Integrations\nDescribe database, auth, and API boundaries here.\n`,
    });
  }

  if (!existingTopicIds.has('deployment')) {
    recs.push({
      id: 'deployment',
      fileName: 'DEPLOYMENT.md',
      title: 'Deployment & Release Runbook',
      priority:
        stack.frameworks.includes('Expo') ||
        stack.frameworks.includes('Docker') ||
        stack.frameworks.includes('Supabase') ||
        stack.configFilesFound.includes('vercel.json')
          ? 'recommended'
          : 'optional',
      reason: 'Prevents release mistakes by recording build commands, env requirements, and rollback steps.',
      templateContent: `---\ntitle: "${project.name} Deployment Runbook"\ntype: "document"\nstatus: "Active"\ntags: ["deployment", "runbook"]\n---\n\n# Deployment Runbook — ${project.name}\n\n## Pre-Flight Checklist\n- [ ] Verify all tests pass (\`${testCmd}\`)\n- [ ] Confirm production environment variables are set\n${stack.frameworks.includes('Expo') ? '- [ ] Run `npx expo-doctor` and verify EAS build profile\n' : ''}\n## Build & Deploy\n\`\`\`bash\n${isPythonOnly ? 'docker build -t ' + project.name.toLowerCase() + ' .' : stack.scripts.build ? run('build') : run('build') + '  # add a build script'}\n\`\`\`\n`,
    });
  }

  if (!existingTopicIds.has('contributing')) {
    recs.push({
      id: 'contributing',
      fileName: 'CONTRIBUTING.md',
      title: 'Contributing Guidelines',
      priority: 'optional',
      reason: 'Standardizes branch naming, commit conventions, and PR verification checks.',
      templateContent: `---\ntitle: "Contributing to ${project.name}"\ntype: "document"\nstatus: "Active"\ntags: ["contributing", "governance"]\n---\n\n# Contributing to ${project.name}\n\n## Development Workflow\n1. Create a feature branch from \`main\`\n2. Run \`${testCmd}\` before opening a Pull Request\n3. Keep documentation in sync with code changes\n`,
    });
  }

  if (!existingTopicIds.has('changelog')) {
    recs.push({
      id: 'changelog',
      fileName: 'CHANGELOG.md',
      title: 'Release Changelog',
      priority: 'optional',
      reason: 'Tracks version upgrades, SDK migrations, and breaking changes over time.',
      templateContent: `---\ntitle: "${project.name} Changelog"\ntype: "document"\nstatus: "Active"\ntags: ["changelog", "releases"]\n---\n\n# Changelog\n\n## [Unreleased]\n- Initial documentation health audit & stack baseline\n`,
    });
  }

  return recs;
}

export function auditProjectDocumentation(
  project: ProjectWorkspace,
  stackProfile: DetectedStackProfile,
  nowMs = Date.now()
): ProjectDocAuditReport {
  const files = project.files;
  const pathSet = new Set(files.map((f) => f.path.toLowerCase()));
  const latestActivityMs = files.reduce((max, f) => Math.max(max, f.lastModifiedMs || 0), 0);

  // Track inbound references (both markdown relative links and wiki links)
  const inboundCount = new Map<string, number>();
  const inboundSources = new Map<string, Set<string>>();
  const addInbound = (targetLowerPath: string, sourcePath: string) => {
    inboundCount.set(targetLowerPath, (inboundCount.get(targetLowerPath) || 0) + 1);
    const set = inboundSources.get(targetLowerPath) || new Set<string>();
    set.add(sourcePath);
    inboundSources.set(targetLowerPath, set);
  };

  for (const f of files) {
    const relLinks = extractRelativeMarkdownLinks(f.body);
    for (const rel of relLinks) {
      const resolved = resolveRelativeDocPath(f.path, rel).toLowerCase();
      if (resolved !== f.path.toLowerCase()) {
        addInbound(resolved, f.path);
      }
    }
    const wikiRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let wm: RegExpExecArray | null;
    while ((wm = wikiRegex.exec(f.body)) !== null) {
      const target = wm[1].trim().toLowerCase();
      for (const candidate of files) {
        if (
          candidate.path !== f.path &&
          (candidate.name.toLowerCase().replace(/\.md$/, '') === target ||
            candidate.path.toLowerCase().replace(/\.md$/, '') === target ||
            (candidate.frontmatter.title || '').toLowerCase() === target)
        ) {
          addInbound(candidate.path.toLowerCase(), f.path);
        }
      }
    }
  }

  const computeCanonicalScore = (f: MarkdownFile): number => {
    const lowerPath = f.path.toLowerCase();
    let score = 0;
    if (!f.path.includes('/')) score += 40;
    if (lowerPath.startsWith('docs/')) score += 15;
    const refs = inboundCount.get(lowerPath) || 0;
    score += Math.min(refs * 20, 60);
    if ((f.wordCount || 0) >= 80) score += 10;
    if (/\b(copy|backup|old|tmp|temp|archive|_archive|draft|scratch|dup)\b/i.test(lowerPath)) {
      score -= 40;
    }
    if (f.frontmatter.status === 'Archived') score -= 25;
    return score;
  };

  // Group files matching canonical topics so duplicates are flagged cleanly
  const topicMatches = new Map<string, MarkdownFile[]>();
  for (const f of files) {
    for (const topic of CANONICAL_TOPICS) {
      if (topic.patterns.some((re) => re.test(f.name))) {
        const list = topicMatches.get(topic.id) || [];
        list.push(f);
        topicMatches.set(topic.id, list);
      }
    }
  }

  const canonicalFileIds = new Set<string>();
  const scopedModuleFileIds = new Set<string>();
  const duplicateTargetByFileId = new Map<string, string>();
  const duplicateSimilarityByFileId = new Map<string, number>();
  const existingTopicIds = new Set<string>();

  for (const [topicId, matches] of topicMatches.entries()) {
    existingTopicIds.add(topicId);
    // Prefer highest canonicalScore (root path + incoming links + non-archive), then recency, then wordCount
    const sorted = [...matches].sort((a, b) => {
      const scoreDiff = computeCanonicalScore(b) - computeCanonicalScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      const modDiff = (b.lastModifiedMs || 0) - (a.lastModifiedMs || 0);
      if (modDiff !== 0) return modDiff;
      return (b.wordCount || 0) - (a.wordCount || 0);
    });
    const primary = sorted[0];
    canonicalFileIds.add(primary.id);
    const primaryDir = getParentDir(primary.path);

    for (let i = 1; i < sorted.length; i++) {
      const candidate = sorted[i];
      if (candidate.frontmatter.scope === 'module' || candidate.frontmatter.audit_exempt === true) {
        scopedModuleFileIds.add(candidate.id);
        continue;
      }

      const candidateDir = getParentDir(candidate.path);
      const sameDir = candidateDir === primaryDir;
      const explicitCopy =
        isExplicitCopyName(candidate.name) ||
        /\b(copy|backup|old|dup|duplicate)\b/i.test(candidate.path);
      const similarity = computeBodySimilarity(primary.body, candidate.body);

      if (sameDir || explicitCopy || similarity >= 0.55) {
        duplicateTargetByFileId.set(candidate.id, primary.path);
        duplicateSimilarityByFileId.set(candidate.id, Math.round(similarity * 100));
      } else {
        // Distinct module/subfolder README or spec with unrelated content
        scopedModuleFileIds.add(candidate.id);
      }
    }
  }

  // Explicit copies of any document (`setup-copy.md`, `notes (1).md`, `plan_backup.md`)
  for (const f of files) {
    if (duplicateTargetByFileId.has(f.id) || canonicalFileIds.has(f.id)) continue;
    if (f.frontmatter.scope === 'module' || f.frontmatter.audit_exempt === true) continue;
    const originalName = originalNameForCopy(f.name);
    if (!originalName) continue;
    const dir = getParentDir(f.path);
    const candidates = files.filter((o) => o.id !== f.id && o.name.toLowerCase() === originalName.toLowerCase());
    const original = candidates.find((o) => getParentDir(o.path) === dir) || candidates[0];
    if (!original) continue;
    duplicateTargetByFileId.set(f.id, original.path);
    duplicateSimilarityByFileId.set(f.id, Math.round(computeBodySimilarity(original.body, f.body) * 100));
  }

  const counts: Record<DocTaxonomyStatus, number> = {
    canonical: 0,
    healthy: 0,
    'module-doc': 0,
    stale: 0,
    duplicate: 0,
    deprecated: 0,
    orphan: 0,
    'agent-system': 0,
  };

  const inventory: DocInventoryItem[] = files.map((file) => {
    const issues: string[] = [];
    const brokenLinks: string[] = [];
    const lowerPath = file.path.toLowerCase();
    const lowerName = file.name.toLowerCase();
    const category = detectCategory(file);

    // 1. Check broken local markdown links
    for (const rel of extractRelativeMarkdownLinks(file.body)) {
      const resolved = resolveRelativeDocPath(file.path, rel).toLowerCase();
      if (!pathSet.has(resolved)) {
        brokenLinks.push(rel);
      }
    }
    if (brokenLinks.length > 0) {
      issues.push(`${brokenLinks.length} broken local link${brokenLinks.length > 1 ? 's' : ''} (${brokenLinks[0]})`);
    }

    // 2. Dev-server port drift against the configured port (database/service ports are ignored)
    const driftedPorts = findPortDrift(file.body, stackProfile.localPort);
    if (driftedPorts.length > 0) {
      issues.push(
        `Port drift: doc mentions localhost:${driftedPorts.join(', localhost:')}, config uses :${stackProfile.localPort}`
      );
    }

    // 3. Expo SDK drift
    const docSdk = findExpoSdkDrift(file.body, stackProfile.expoSdkVersion);
    if (docSdk !== null) {
      issues.push(
        `SDK drift: doc references Expo SDK ${docSdk}, project uses SDK ${parseInt(stackProfile.expoSdkVersion || '', 10)}`
      );
    }

    // 4. Empty / stub check
    if ((file.wordCount || 0) < 15) {
      issues.push('Near-empty stub document (<15 words)');
    }

    // 5. Age check: >180 days behind the project's most recent doc edit. Judging against the wall clock
    // would mark every doc of a dormant project stale, which is noise rather than drift.
    if (file.lastModifiedMs && latestActivityMs && !isAgeExempt(file)) {
      const behindDays = (latestActivityMs - file.lastModifiedMs) / DAY_MS;
      if (behindDays > STALE_AFTER_DAYS) {
        const ageDays = Math.round((nowMs - file.lastModifiedMs) / DAY_MS);
        issues.push(`Not updated in ${ageDays} days while the project kept changing`);
      }
    }

    // Classify status (mutually exclusive, highest precedence first)
    let status: DocTaxonomyStatus = 'healthy';
    const duplicateOf = duplicateTargetByFileId.get(file.id);
    const hasDriftOrBrokenLinks = issues.some((i) => i.includes('drift') || i.includes('broken'));

    const isScratchpadOrOrphanName =
      /(^|[-_. ])(notes?|todo\d*|scratch(pad)?|temp|tmp|wip|dump|untitled|draft)([-_. \d]|$)/i.test(lowerName) &&
      (inboundCount.get(lowerPath) || 0) === 0;

    const isScopedModuleDoc = scopedModuleFileIds.has(file.id);
    const similarityScore = duplicateSimilarityByFileId.get(file.id);

    if (isDeprecatedDoc(file)) {
      status = 'deprecated';
    } else if (duplicateOf) {
      status = 'duplicate';
      const simSuffix = similarityScore !== undefined ? ` (${similarityScore}% content overlap)` : '';
      issues.unshift(`Duplicates canonical ${duplicateOf}${simSuffix}`);
    } else if (category === 'Agent / Skill') {
      status = 'agent-system';
    } else if (canonicalFileIds.has(file.id)) {
      status = hasDriftOrBrokenLinks ? 'stale' : 'canonical';
    } else if (isScopedModuleDoc) {
      status = hasDriftOrBrokenLinks ? 'stale' : 'module-doc';
    } else if (isScratchpadOrOrphanName) {
      status = 'orphan';
      issues.push('Unlinked scratchpad/notes file (no inbound links)');
    } else if (issues.length > 0) {
      status = 'stale';
    }

    counts[status]++;

    const referencedByFiles = Array.from(inboundSources.get(lowerPath) || []);
    return {
      fileId: file.id,
      path: file.path,
      name: file.name,
      title: file.frontmatter.title || file.name,
      status,
      category,
      wordCount: file.wordCount,
      lastModifiedMs: file.lastModifiedMs,
      issues,
      duplicateOf,
      similarityScore,
      isScopedModuleDoc,
      incomingLinksCount: referencedByFiles.length,
      referencedByFiles,
      canonicalScore: computeCanonicalScore(file),
      brokenLinks,
    };
  });

  const missingDocs = buildMissingDocRecommendations(project, stackProfile, existingTopicIds);

  // Compute health score (0-100)
  let score = 100;
  for (const m of missingDocs) {
    if (m.priority === 'critical') score -= 18;
    else if (m.priority === 'recommended') score -= 8;
  }

  // Document problems are scored as a weighted share of the project (so large repos are judged fairly),
  // plus a small capped absolute term so a single problem in a big repo still registers.
  // Docs already moved into an archive folder are resolved and cost nothing.
  const PROBLEM_WEIGHT: Partial<Record<DocTaxonomyStatus, number>> = { duplicate: 1, stale: 0.8, orphan: 0.5, deprecated: 0.3 };
  let weightedProblems = 0;
  let problemDocs = 0;
  for (const item of inventory) {
    const weight = PROBLEM_WEIGHT[item.status];
    if (!weight) continue;
    if (item.status === 'deprecated' && isInArchiveFolder(item.path)) continue;
    weightedProblems += weight;
    problemDocs++;
  }
  if (inventory.length > 0) {
    score -= Math.round(60 * (weightedProblems / inventory.length)) + Math.min(problemDocs, 5);
  }

  // Stack age is scored separately (see stackFreshness.ts) so the doc grade reflects documentation only.

  const healthScore = Math.max(0, Math.min(100, Math.round(score)));
  const grade: ProjectDocAuditReport['grade'] =
    healthScore >= 85 ? 'A' : healthScore >= 70 ? 'B' : healthScore >= 50 ? 'C' : 'D';

  return {
    healthScore,
    grade,
    inventory,
    counts,
    missingDocs,
    stackProfile,
    auditedAt: new Date(nowMs).toISOString(),
  };
}
