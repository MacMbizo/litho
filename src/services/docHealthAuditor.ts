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

function computeBodySimilarity(bodyA: string, bodyB: string): number {
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

function extractRelativeMarkdownLinks(body: string): string[] {
  const links: string[] = [];
  const regex = /\[[^\]]+\]\(([^)#\s]+)(?:#[^)]*)?\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    const target = match[1].trim();
    if (
      target &&
      !target.startsWith('http://') &&
      !target.startsWith('https://') &&
      !target.startsWith('mailto:') &&
      !target.startsWith('data:') &&
      /\.(md|markdown|mdx)$/i.test(target)
    ) {
      links.push(target);
    }
  }
  return links;
}

function resolveRelativeDocPath(fromFilePath: string, linkTarget: string): string {
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
  const devCmd = stack.scripts.dev
    ? 'npm run dev'
    : stack.scripts.start
    ? 'npm start'
    : 'npm run dev';
  const testCmd = stack.scripts.test ? 'npm test' : 'npm test';

  if (!existingTopicIds.has('readme')) {
    recs.push({
      id: 'readme',
      fileName: 'README.md',
      title: 'Project README & Quick Start',
      priority: 'critical',
      reason: 'Every repository needs a canonical README explaining purpose, setup, and commands.',
      templateContent: `---\ntitle: "${project.name}"\ntype: "project"\nstatus: "Active"\ntags: ["readme", "overview"]\n---\n\n# ${project.name}\n\n> Stack: ${stackSummary}\n\n## Quick Start\n\n\`\`\`bash\nnpm install\n${devCmd}\n\`\`\`\n\n## Environment Variables\n\nCopy \`.env.example\` to \`.env\` and configure required credentials.\n\n## Testing\n\n\`\`\`bash\n${testCmd}\n\`\`\`\n`,
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
      templateContent: `---\ntitle: "${project.name} Deployment Runbook"\ntype: "document"\nstatus: "Active"\ntags: ["deployment", "runbook"]\n---\n\n# Deployment Runbook — ${project.name}\n\n## Pre-Flight Checklist\n- [ ] Verify all tests pass (\`${testCmd}\`)\n- [ ] Confirm production environment variables are set\n${stack.frameworks.includes('Expo') ? '- [ ] Run `npx expo-doctor` and verify EAS build profile\n' : ''}\n## Build & Deploy\n\`\`\`bash\nnpm run build\n\`\`\`\n`,
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

  const counts: Record<DocTaxonomyStatus, number> = {
    canonical: 0,
    healthy: 0,
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

    // 2. Check port drift against stackProfile.localPort
    if (stackProfile.localPort) {
      const portMatches = file.body.match(/localhost:(\d{4,5})/g) || [];
      for (const pm of portMatches) {
        const mentioned = Number(pm.split(':')[1]);
        if (mentioned && mentioned !== stackProfile.localPort && [3000, 5173, 8081, 4000, 8000].includes(mentioned)) {
          issues.push(`Port drift: doc mentions localhost:${mentioned}, config uses :${stackProfile.localPort}`);
          break;
        }
      }
    }

    // 3. Check Expo SDK drift in docs
    if (stackProfile.expoSdkVersion) {
      const docExpoMatch = file.body.match(/Expo\s+SDK\s+(\d{2})/i);
      const currentExpoMajor = parseInt(stackProfile.expoSdkVersion, 10);
      if (docExpoMatch && currentExpoMajor && Number(docExpoMatch[1]) !== currentExpoMajor) {
        issues.push(`SDK drift: doc references Expo SDK ${docExpoMatch[1]}, project uses SDK ${currentExpoMajor}`);
      }
    }

    // 4. Empty / stub check
    if ((file.wordCount || 0) < 15) {
      issues.push('Near-empty stub document (<15 words)');
    }

    // 5. Age check (>180 days without edit)
    const ageDays = file.lastModifiedMs ? (nowMs - file.lastModifiedMs) / (1000 * 60 * 60 * 24) : 0;
    if (ageDays > 180) {
      issues.push(`Not updated in ${Math.round(ageDays)} days`);
    }

    // Classify status
    let status: DocTaxonomyStatus = 'healthy';
    const duplicateOf = duplicateTargetByFileId.get(file.id);

    const isDeprecated =
      file.frontmatter.status === 'Archived' ||
      /\b(deprecated|legacy|old|obsolete|archive)\b/i.test(lowerPath) ||
      /^\s*>?\s*\[?!?(DEPRECATED|OBSOLETE)/im.test(file.body.slice(0, 300));

    const isScratchpadOrOrphanName =
      /\b(notes?|todo2?|scratch(pad)?|temp|wip|dump|untitled)\b/i.test(lowerName) &&
      (inboundCount.get(lowerPath) || 0) === 0;

    const isScopedModuleDoc = scopedModuleFileIds.has(file.id);
    const similarityScore = duplicateSimilarityByFileId.get(file.id);

    if (isDeprecated) {
      status = 'deprecated';
    } else if (duplicateOf) {
      status = 'duplicate';
      const simSuffix = similarityScore !== undefined ? ` (${similarityScore}% content overlap)` : '';
      issues.unshift(`Duplicates canonical ${duplicateOf}${simSuffix}`);
    } else if (category === 'Agent / Skill') {
      status = 'agent-system';
    } else if (canonicalFileIds.has(file.id)) {
      status = issues.some((i) => i.includes('drift') || i.includes('broken')) ? 'stale' : 'canonical';
    } else if (isScratchpadOrOrphanName) {
      status = 'orphan';
      if (!issues.some((i) => i.includes('unlinked'))) {
        issues.push('Unlinked scratchpad/notes file in workspace');
      }
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
  score -= counts.duplicate * 6;
  score -= counts.stale * 5;
  score -= counts.deprecated * 3;
  score -= counts.orphan * 4;

  // Penalize critical SDK drift in stack
  const criticalStackCount = stackProfile.dependencies.filter((d) => d.severity === 'critical').length;
  score -= criticalStackCount * 8;

  const healthScore = Math.max(15, Math.min(100, score));
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
