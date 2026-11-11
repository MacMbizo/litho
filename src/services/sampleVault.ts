import { MarkdownFile, FileTreeNode, ProjectWorkspace } from '../types/document';
import { MarkdownService } from './markdown';

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
  }
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
  
  const tree: FileTreeNode = {
    id: 'root',
    name: 'Sample Vault',
    path: '',
    isFolder: true,
    children: [
      {
        id: 'projects',
        name: 'projects',
        path: 'projects',
        isFolder: true,
        itemCount: 1,
        children: [
          {
            id: 'projects/project-nexus.md',
            name: 'project-nexus.md',
            path: 'projects/project-nexus.md',
            isFolder: false,
            docType: 'project',
            metadata: files[0].frontmatter,
          }
        ]
      },
      {
        id: 'agents',
        name: 'agents',
        path: 'agents',
        isFolder: true,
        itemCount: 2,
        children: [
          {
            id: 'agents/senior-code-reviewer.md',
            name: 'senior-code-reviewer.md',
            path: 'agents/senior-code-reviewer.md',
            isFolder: false,
            docType: 'agent',
            metadata: files[1].frontmatter,
          },
          {
            id: 'agents/executive-briefing-agent.md',
            name: 'executive-briefing-agent.md',
            path: 'agents/executive-briefing-agent.md',
            isFolder: false,
            docType: 'agent',
            metadata: files[2].frontmatter,
          }
        ]
      },
      {
        id: 'skills',
        name: 'skills',
        path: 'skills',
        isFolder: true,
        itemCount: 2,
        children: [
          {
            id: 'skills/rag-vector-search.md',
            name: 'rag-vector-search.md',
            path: 'skills/rag-vector-search.md',
            isFolder: false,
            docType: 'skill',
            metadata: files[3].frontmatter,
          },
          {
            id: 'skills/markdown-pdf-exporter.md',
            name: 'markdown-pdf-exporter.md',
            path: 'skills/markdown-pdf-exporter.md',
            isFolder: false,
            docType: 'skill',
            metadata: files[4].frontmatter,
          }
        ]
      },
      {
        id: 'docs',
        name: 'docs',
        path: 'docs',
        isFolder: true,
        itemCount: 1,
        children: [
          {
            id: 'docs/architecture-adr-001.md',
            name: 'architecture-adr-001.md',
            path: 'docs/architecture-adr-001.md',
            isFolder: false,
            docType: 'document',
            metadata: files[5].frontmatter,
          }
        ]
      }
    ]
  };

  return {
    name: 'Sample Workspace',
    rootPath: 'sample-vault',
    isLocalFolder: false,
    tree,
    files,
  };
}
