import { MarkdownFile, FileTreeNode, ProjectWorkspace } from '../types/document';
import { MarkdownService } from './markdown';
import { buildTreeFromFiles } from './fileTree';

export const INITIAL_FILES: { path: string; name: string; raw: string }[] = [
  {
    path: 'projects/project-nexus.md',
    name: 'project-nexus.md',
    raw: `---
title: "Project Nexus - Autonomous Agent Engine"
type: "project"
status: "In Progress"
priority: "High"
tags: ["ai", "agents", "core-engine", "roadmap"]
author: "Alex Rivers"
created_at: "2026-10-15"
updated_at: "2026-11-05"
---

# Project Nexus - Autonomous Agent Engine

> The next-generation local-first execution layer for intelligent agents and distributed workflows.

## Mission Statement
Project Nexus delivers zero-latency, private, and deterministic execution of reasoning agents across heterogeneous devices while maintaining strict Markdown and Git traceability.

## Key Deliverables & Action Items
- [x] Complete architecture decision record for local event loop
- [x] Implement YAML frontmatter reactive indexer
- [ ] Connect SQLite-FTS5 full-text search engine
- [ ] Deliver bidirectional Kanban drag-and-drop sync
- [ ] Implement multi-provider agent fallback (Ollama -> Gemini)
- [ ] Package production release binary

## Architecture Overview
The system relies on a triple-layer reactive architecture coordinating [[Senior Code Reviewer Agent]] and [[Executive Briefing & Doc Synthesizer]]:
1. **Physical Storage**: 100% human-readable Markdown files stored in user-designated directories.
2. **Metadata Ingest**: High-throughput frontmatter tokenizer parsing key attributes on change.
3. **Reactive UI State**: Notion-grade block editor, multi-view database boards, and global task aggregators.

\`\`\`mermaid
flowchart LR
  Vault([Markdown Vault]) --> Parser[YAML + AST Engine]
  Parser --> Graph{Knowledge Graph}
  Graph -->|Context| Agent[[Senior Code Reviewer]]
  Graph -->|RAG| Chat([Vault AI Chat])
\`\`\`

## Relevance Scoring Formula
$$
S(q, d) = \\sum_{i=1}^{n} \\frac{\\text{tf}(q_i, d) \\cdot \\alpha}{1 + \\lambda \\cdot \\Delta t}
$$

## Team Notes
* Ensure all database columns remain strictly synchronized with the underlying markdown frontmatter.
* Avoid proprietary binary cache files outside of the standard \`.cache\` directory.
`
  },
  {
    path: 'agents/senior-code-reviewer.md',
    name: 'senior-code-reviewer.md',
    raw: `---
title: "Senior Code Reviewer Agent"
type: "agent"
status: "Active"
priority: "Critical"
tags: ["agent", "code-quality", "security", "rust", "typescript"]
model: "llama3:latest"
tools: ["git_diff", "ast_grep", "eslint", "cargo_check"]
author: "Engineering Lead"
created_at: "2026-10-20"
---

# Senior Code Reviewer Agent

> Autonomous reviewer enforcing security, performance, and idiomatic conventions across pull requests.

## System Prompt
You are a Staff Software Engineer and Senior Code Reviewer. You analyze code diffs with uncompromising attention to:
1. Security vulnerabilities (OWASP top 10, sanitization, memory safety)
2. Performance regressions and unnecessary allocations
3. Maintainability, clean abstractions, and test coverage

Provide concise, empathetic, and actionable inline code comments. Format all suggested revisions using markdown diff blocks.

## Tools Configured
- [x] \`git_diff\`: Inspect commit changes
- [x] \`ast_grep\`: Semantic code pattern matching
- [x] \`eslint\`: Style and lint verification
- [ ] \`security_audit\`: Dependency CVE scanner

## Sample Test Prompts
* \`Review PR #142: optimize database connection pooling\`
* \`Analyze memory usage in WebSocket stream handler\`
`
  },
  {
    path: 'agents/executive-briefing-agent.md',
    name: 'executive-briefing-agent.md',
    raw: `---
title: "Executive Briefing & Doc Synthesizer"
type: "agent"
status: "Active"
priority: "Medium"
tags: ["agent", "nlp", "summarization", "executive"]
model: "gemini-1.5-flash"
tools: ["vault_crawler", "summarizer", "calendar_sync"]
author: "Ops Team"
created_at: "2026-11-01"
---

# Executive Briefing & Doc Synthesizer

> Scans project documentation, aggregates progress, and prepares daily C-level executive briefings.

## System Prompt
You are an executive chief-of-staff AI. You synthesize complex project trees, changelogs, and task checklists into crisp, 3-minute executive briefings highlighting:
- Top 3 Achievements
- Critical Blockers & Risk Items
- Immediate Next Actions

## Action Items
- [x] Build automated morning digest template
- [ ] Hook into Slack / Discord webhooks
- [ ] Add sentiment analysis on project meeting notes
`
  },
  {
    path: 'skills/rag-vector-search.md',
    name: 'rag-vector-search.md',
    raw: `---
title: "Skill: Local RAG & Vector Embeddings"
type: "skill"
status: "Active"
category: "AI Ops"
version: "1.2.0"
tags: ["skill", "embeddings", "vector", "sqlite-vec"]
created_at: "2026-09-12"
---

# Skill: Local RAG & Vector Embeddings

## Purpose
Provides automated chunking, embedding generation, and cosine similarity vector retrieval over local Markdown documentation.

## Procedure Steps
- [x] Initialize embedded vector table in SQLite
- [x] Chunk markdown into semantic sections based on \`#\` and \`##\` headers
- [ ] Compute 384-dimension embeddings via local MiniLM or Ollama
- [ ] Query top-k nearest neighbors with cosine threshold >= 0.78
- [ ] Synthesize answer with contextual citations

## Example Usage
\`\`\`typescript
const results = await ragSkill.query({
  query: "How does the frontmatter indexer handle corrupt YAML?",
  topK: 3
});
\`\`\`
`
  },
  {
    path: 'skills/markdown-pdf-exporter.md',
    name: 'markdown-pdf-exporter.md',
    raw: `---
title: "Skill: Notion-Grade PDF & Word Export"
type: "skill"
status: "Draft"
category: "Export & Publishing"
version: "0.9.0"
tags: ["skill", "pdf", "docx", "print", "styling"]
created_at: "2026-11-03"
---

# Skill: Notion-Grade PDF & Word Export

## Overview
Compiles Markdown with embedded KaTeX formulas, Mermaid diagrams, and callout blocks into publication-ready PDF and DOCX files.

## Checklist
- [x] Configure print CSS stylesheet
- [ ] Mermaid SVG rasterization pipeline
- [ ] KaTeX web font embedding
- [ ] Custom page headers and footers with page numbering
`
  },
  {
    path: 'docs/architecture-adr-001.md',
    name: 'architecture-adr-001.md',
    raw: `---
title: "ADR 001: Local-First Markdown with Frontmatter Database"
type: "document"
status: "Done"
priority: "High"
tags: ["architecture", "adr", "storage", "privacy"]
author: "Alex Rivers"
created_at: "2026-08-30"
---

# ADR 001: Local-First Markdown with Frontmatter Database

## Context & Problem Statement
Users demand the fluid, drag-and-drop convenience of cloud databases like Notion, but refuse vendor lock-in, latency, or sending private corporate project specs to 3rd-party servers.

## Decision
We store all user data as standard GitHub Flavored Markdown files with YAML frontmatter headers. An ephemeral or cached in-memory/SQLite index parses frontmatter attributes to power Table, Kanban, and Gallery views.

## Consequences
- **Positive**: 100% data ownership. Notes can be opened in Obsidian, VS Code, or terminal at any moment.
- **Positive**: Zero cloud subscription dependency.
- **Positive**: Git-friendly; every change is a readable text diff.
`
  },
  // ---- DocAtlas demo documents: one per DocPassport state ----
  {
    path: 'README.md',
    name: 'README.md',
    raw: `---
title: "Nexus Workspace"
type: "project"
status: "Active"
tags: ["readme", "overview"]
---

# Nexus Workspace

Local-first knowledge base for the Nexus agent platform. Specs, agents and skills live here as plain Markdown so they can be versioned with the code.

## Quick Start

Install dependencies with npm install, then run npm run dev and open http://localhost:3000 in your browser.

## Documentation

- [Setup Guide](docs/SETUP.md)
- [ADR 001: Local-First Storage](docs/architecture-adr-001.md)
- [Agent Runtime Package](packages/agent-runtime/README.md)
- [Deployment Notes](docs/deploy-notes.md)
`,
  },
  {
    path: 'docs/SETUP.md',
    name: 'SETUP.md',
    raw: `---
title: "Setup Guide"
type: "document"
status: "Active"
tags: ["setup", "onboarding"]
---

# Setup Guide

1. Install Node.js 22 and run npm install from the repository root.
2. Copy .env.example to .env and add your local model endpoint.
3. Start the renderer with npm run dev; Vite serves the app on http://localhost:5173.
4. Seed the sample vault by opening the Sample Vault from the project switcher.

Questions go to the team channel; see the [README](../README.md) for the overview.
`,
  },
  {
    path: 'docs/SETUP-copy.md',
    name: 'SETUP-copy.md',
    raw: `---
title: "Setup Guide"
type: "document"
status: "Active"
tags: ["setup", "onboarding"]
---

# Setup Guide

1. Install Node.js 22 and run npm install from the repository root.
2. Copy .env.example to .env and add your local model endpoint.
3. Start the renderer with npm run dev; Vite serves the app on http://localhost:5173.
4. Seed the sample vault by opening the Sample Vault from the project switcher.
`,
  },
  {
    path: 'packages/agent-runtime/README.md',
    name: 'README.md',
    raw: `---
title: "Agent Runtime Package"
type: "document"
status: "Active"
tags: ["package", "runtime"]
---

# Agent Runtime

Executes agent manifests in an isolated worker: resolves declared tools, streams model tokens over a message channel, and enforces per-tool timeouts and token budgets. Exposes a small typed API consumed by the Agent Playground.
`,
  },
  {
    path: 'notes/scratchpad.md',
    name: 'scratchpad.md',
    raw: `# Scratchpad

- try hybrid BM25 + vector ranking for project chat
- graph view: cluster by folder?
- ask about exporting kanban boards to PDF
`,
  },
  {
    path: 'docs/legacy-sync-design.md',
    name: 'legacy-sync-design.md',
    raw: `---
title: "Cloud Sync Design (v0)"
type: "document"
status: "Active"
tags: ["sync", "design"]
---

> [!WARNING] **Deprecated:** Superseded by [ADR 001](architecture-adr-001.md).

# Cloud Sync Design (v0)

The original plan mirrored every note to a hosted database and resolved conflicts on the server. It was dropped in favour of local-first Markdown files.
`,
  },
  {
    path: 'docs/deploy-notes.md',
    name: 'deploy-notes.md',
    raw: `---
title: "Deployment Notes"
type: "document"
status: "Active"
tags: ["deployment", "release"]
---

# Deployment Notes

Desktop builds are produced with npm run build followed by electron-builder. Release candidates are smoke-tested against the sample vault and a large local project before tagging. See the [release checklist](release-checklist.md).
`,
  },
];

export function getSampleVault(): MarkdownFile[] {
  return INITIAL_FILES.map((file) => {
    const parsed = MarkdownService.parse(file.raw, file.path);
    return {
      id: file.path,
      path: file.path,
      name: file.name,
      content: file.raw,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      wordCount: parsed.wordCount,
      tasks: parsed.tasks,
      isDirty: false,
    };
  });
}

export function getSampleWorkspace(): ProjectWorkspace {
  const files = getSampleVault();
  return {
    name: 'Sample Workspace',
    rootPath: 'sample-vault',
    isLocalFolder: false,
    tree: buildTreeFromFiles(files, 'Sample Vault'),
    files,
    // A small manifest so DocAtlas can demonstrate stack detection and port-drift checks in the browser.
    configFiles: {
      'package.json': JSON.stringify(
        {
          name: 'nexus-workspace',
          private: true,
          scripts: { dev: 'vite', build: 'tsc && vite build', test: 'node --test' },
          dependencies: { react: '^19.1.0', 'react-dom': '^19.1.0' },
          devDependencies: { vite: '^7.1.0', typescript: '^5.9.0', electron: '^43.0.0', tailwindcss: '^4.1.0' },
        },
        null,
        2
      ),
    },
  };
}
