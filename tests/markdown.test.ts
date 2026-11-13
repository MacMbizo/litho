import assert from 'node:assert';
import test from 'node:test';
import { MarkdownService } from '../src/services/markdown.ts';
import { inspectProjectStack, generateUpgradePlanMarkdown } from '../src/services/stackInspector.ts';
import { auditProjectDocumentation } from '../src/services/docHealthAuditor.ts';
import type { ProjectWorkspace } from '../src/types/document.ts';

test('MarkdownService: parses frontmatter, tasks, and body accurately', () => {
  const sample = `---
title: "Autonomous Agent Alpha"
type: "agent"
status: "Active"
priority: "High"
tags: ["ai", "security"]
model: "llama3"
tools: ["web_search", "run_cmd"]
---

# Autonomous Agent Alpha

## Tasks
- [ ] Task 1: Initialize database
- [x] Task 2: Validate tokens
`;

  const parsed = MarkdownService.parse(sample, 'agents/alpha.md');

  assert.strictEqual(parsed.frontmatter.title, 'Autonomous Agent Alpha');
  assert.strictEqual(parsed.frontmatter.type, 'agent');
  assert.strictEqual(parsed.frontmatter.status, 'Active');
  assert.strictEqual(parsed.frontmatter.model, 'llama3');
  assert.deepStrictEqual(parsed.frontmatter.tools, ['web_search', 'run_cmd']);
  assert.strictEqual(parsed.tasks.length, 2);
  assert.strictEqual(parsed.tasks[0].completed, false);
  assert.strictEqual(parsed.tasks[1].completed, true);
  assert.strictEqual(parsed.tasks[0].text, 'Task 1: Initialize database');
});

test('MarkdownService: stringify round-trip preserves YAML frontmatter and body', () => {
  const frontmatter = {
    title: 'Project Roadmap',
    type: 'project',
    status: 'In Progress',
    priority: 'Critical',
    tags: ['core', 'release'],
  };
  const body = '# Project Roadmap\n\n- [ ] Deliver MVP\n';

  const stringified = MarkdownService.stringify(frontmatter as any, body);
  const parsedBack = MarkdownService.parse(stringified);

  assert.strictEqual(parsedBack.frontmatter.title, 'Project Roadmap');
  assert.strictEqual(parsedBack.frontmatter.type, 'project');
  assert.strictEqual(parsedBack.frontmatter.status, 'In Progress');
  assert.strictEqual(parsedBack.frontmatter.priority, 'Critical');
  assert.deepStrictEqual(parsedBack.frontmatter.tags, ['core', 'release']);
});

test('MarkdownService: toggleTask accurately toggles checkbox at specific line', () => {
  const body = `# Checklists\n\n- [ ] Step 1\n- [x] Step 2\n- [ ] Step 3\n`;

  // Step 1 is on line 3 (1-indexed)
  const updated = MarkdownService.toggleTask(body, 3, true);
  assert.ok(updated.includes('- [x] Step 1'));

  // Toggle Step 2 back to false (line 4)
  const toggledBack = MarkdownService.toggleTask(updated, 4, false);
  assert.ok(toggledBack.includes('- [ ] Step 2'));
});

test('MarkdownService: hasFrontmatter accurately detects YAML headers', () => {
  const withHeader = `---
title: "Sample"
type: "document"
---
# Content`;
  const withoutHeader = `# Raw Title\n\nJust markdown body without frontmatter.`;

  assert.strictEqual(MarkdownService.hasFrontmatter(withHeader), true);
  assert.strictEqual(MarkdownService.hasFrontmatter(withoutHeader), false);
});

test('MarkdownService: upgradeRawMarkdown prepends clean YAML header without altering body', () => {
  const raw = `# Architecture Overview\n\nHere are system design notes.`;
  const upgraded = MarkdownService.upgradeRawMarkdown(raw, {
    title: 'Architecture Overview',
    type: 'project',
    tags: ['system', 'design'],
  });

  assert.strictEqual(MarkdownService.hasFrontmatter(upgraded), true);
  const parsed = MarkdownService.parse(upgraded);
  assert.strictEqual(parsed.frontmatter.title, 'Architecture Overview');
  assert.strictEqual(parsed.frontmatter.type, 'project');
  assert.deepStrictEqual(parsed.frontmatter.tags, ['system', 'design']);
  assert.ok(parsed.body.includes('Here are system design notes.'));
});

test('MarkdownService: extractWikiLinks parses standard and aliased wiki-links', () => {
  const body = `Coordinate with [[Senior Code Reviewer Agent]] and see [[projects/project-nexus|Project Nexus Roadmap]] for details.`;
  const links = MarkdownService.extractWikiLinks(body);

  assert.strictEqual(links.length, 2);
  assert.strictEqual(links[0].target, 'Senior Code Reviewer Agent');
  assert.strictEqual(links[0].alias, 'Senior Code Reviewer Agent');
  assert.strictEqual(links[1].target, 'projects/project-nexus');
  assert.strictEqual(links[1].alias, 'Project Nexus Roadmap');
});

test('StackInspector: detects Expo SDK from app.config.json and package.json', () => {
  const workspace: ProjectWorkspace = {
    name: 'mobile-app',
    rootPath: '/tmp/mobile-app',
    isLocalFolder: true,
    tree: [],
    files: [],
    configFiles: {
      'app.config.json': JSON.stringify({
        expo: {
          name: 'MobileApp',
          sdkVersion: '52.0.0',
        },
      }),
      'package.json': JSON.stringify({
        name: 'mobile-app',
        dependencies: {
          expo: '~52.0.10',
          'react-native': '0.76.5',
          react: '18.3.1',
        },
      }),
    },
  };

  const profile = inspectProjectStack(workspace);
  assert.ok(profile.frameworks.includes('Expo'));
  assert.ok(profile.frameworks.includes('React Native'));
  const expoDep = profile.dependencies.find((d) => d.name === 'expo');
  assert.ok(expoDep);
  assert.strictEqual(expoDep.currentVersion, '52.0.0');

  // Simulate live version check result for upgrade plan generation
  expoDep.latestVersion = '58.0.0';
  expoDep.severity = 'critical';
  expoDep.upgradeCommands = ['npx expo install expo@latest'];
  const planMd = generateUpgradePlanMarkdown(workspace.name, profile);
  assert.ok(planMd.includes('expo'));
  assert.ok(planMd.includes('58.0.0'));
  assert.ok(planMd.includes('npx expo install expo@latest'));
});

test('DocHealthAuditor: classifies docs, detects duplicates/deprecated/broken links/missing docs', () => {
  const nowMs = Date.UTC(2026, 10, 13);
  const oldMs = nowMs - 220 * 24 * 60 * 60 * 1000;

  const makeDoc = (path: string, content: string, lastModifiedMs = nowMs) => {
    const parsed = MarkdownService.parse(content, path);
    const name = path.split('/').pop() || path;
    return {
      id: path,
      path,
      name,
      content,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      wordCount: parsed.wordCount,
      tasks: parsed.tasks,
      lastModifiedMs,
    };
  };

  const workspace: ProjectWorkspace = {
    name: 'sample-service',
    rootPath: '/tmp/sample-service',
    isLocalFolder: true,
    tree: [],
    files: [
      makeDoc(
        'README.md',
        '# Sample Service\n\nSetup guide at http://localhost:5173.\n\nSee [Architecture](docs/ARCHITECTURE.md) and [Missing](docs/NOPE.md).'
      ),
      makeDoc('docs/ARCHITECTURE.md', '# Architecture\n\nDetailed architecture overview with enough words to be healthy.'),
      makeDoc('archive/old-guide.md', '# Old Guide\n\nDEPRECATED: do not use this anymore.', oldMs),
      makeDoc('notes/readme-copy.md', '# Sample Service\n\nSetup guide on port 5173.\n\nDuplicate notes.'),
      makeDoc('orphan-note.md', '# Random Note\n\nShort.'),
    ],
    configFiles: {
      'package.json': JSON.stringify({
        name: 'sample-service',
        scripts: { dev: 'vite --port 5177' },
        dependencies: { react: '^19.0.0' },
      }),
    },
  };

  const stack = inspectProjectStack(workspace);
  const report = auditProjectDocumentation(workspace, stack, nowMs);

  const readmeItem = report.inventory.find((i) => i.path === 'README.md');
  const archItem = report.inventory.find((i) => i.path === 'docs/ARCHITECTURE.md');
  const oldItem = report.inventory.find((i) => i.path === 'archive/old-guide.md');
  const orphanItem = report.inventory.find((i) => i.path === 'orphan-note.md');

  assert.ok(readmeItem);
  assert.strictEqual(readmeItem.status, 'stale');
  assert.ok(readmeItem.brokenLinks.includes('docs/NOPE.md'));
  assert.ok(readmeItem.issues.some((iss) => iss.includes('5173') || iss.includes('5177')));

  assert.ok(archItem);
  assert.strictEqual(archItem.status, 'canonical');
  assert.ok(archItem.incomingLinksCount >= 1);
  assert.ok(archItem.referencedByFiles.includes('README.md'));
  assert.ok(archItem.canonicalScore > 0);

  assert.ok(oldItem);
  assert.strictEqual(oldItem.status, 'deprecated');

  assert.ok(orphanItem);
  assert.strictEqual(orphanItem.status, 'orphan');

  // DEPLOYMENT.md, CONTRIBUTING.md, CHANGELOG.md should be flagged as missing
  const missingIds = report.missingDocs.map((m) => m.id);
  assert.ok(missingIds.includes('deployment'));
  assert.ok(missingIds.includes('contributing'));
  assert.ok(missingIds.includes('changelog'));
  assert.ok(!missingIds.includes('readme'));
  assert.ok(!missingIds.includes('architecture'));
});

test('DocHealthAuditor: treats unrelated submodule READMEs as scoped module docs, not duplicates', () => {
  const nowMs = Date.UTC(2026, 10, 13);
  const makeDoc = (path: string, content: string) => {
    const parsed = MarkdownService.parse(content, path);
    const name = path.split('/').pop() || path;
    return {
      id: path,
      path,
      name,
      content,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      wordCount: parsed.wordCount,
      tasks: parsed.tasks,
      lastModifiedMs: nowMs,
    };
  };

  const rootReadme =
    '# F4 Main Application\n\nThis repository powers the F4 mobile and web platform with Expo and Supabase.\n\n## Getting Started\nRun npm install and npm run dev to launch locally.';
  const moduleReadme =
    '# Auth & Biometric Module\n\nHandles OAuth2 PKCE tokens, hardware keystore encryption, and session refresh hooks for mobile clients.';
  const copiedReadme =
    '# F4 Main Application\n\nThis repository powers the F4 mobile and web platform with Expo and Supabase.\n\n## Getting Started\nRun npm install and npm run dev to launch locally.';

  const workspace: ProjectWorkspace = {
    name: 'F4',
    rootPath: '/tmp/F4',
    isLocalFolder: true,
    tree: { id: 'root', name: 'F4', path: '', isFolder: true, children: [] },
    files: [
      makeDoc('README.md', rootReadme),
      makeDoc('packages/auth/README.md', moduleReadme),
      makeDoc('docs/README.md', copiedReadme),
    ],
  };

  const stack = inspectProjectStack(workspace);
  const report = auditProjectDocumentation(workspace, stack, nowMs);

  const authDoc = report.inventory.find((i) => i.path === 'packages/auth/README.md');
  const dupDoc = report.inventory.find((i) => i.path === 'docs/README.md');

  assert.ok(authDoc);
  assert.strictEqual(authDoc.status, 'module-doc');
  assert.strictEqual(authDoc.isScopedModuleDoc, true);

  assert.ok(dupDoc);
  assert.strictEqual(dupDoc.status, 'duplicate');
  assert.strictEqual(dupDoc.duplicateOf, 'README.md');
});

