import assert from 'node:assert';
import test from 'node:test';
import { MarkdownService } from '../src/services/markdown.ts';

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
