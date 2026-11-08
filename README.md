# Notion Markdown Studio & AI Agent OS

A local-first desktop application for managing Markdown files for projects, agents, skills, and documentation.

## Core Highlights

1. **Notion-Class Aesthetic & Feel**
   - High-craft dark & light mode styling.
   - Slash command menu (`/h1`, `/todo`, `/callout`, `/code`, `/table`, `/agent_spec`).
   - Sticky floating formatting toolbar with live block rendering.
   - Interactive `- [ ]` checklists that click, check off, and sync live.

2. **Word-Like WYSIWYG with Clean Markdown Fidelity**
   - Live visual blocks synchronized bidirectionally with raw markdown.
   - Preserves frontmatter, code blocks, tables, and callouts with zero data loss.
   - Toggle seamlessly between Notion Rich WYSIWYG and Raw Markdown source.

3. **Notion Database Hub for Agents, Skills, & Projects**
   - **Table View**: Spreadsheet layout with sorting, inline status dropdowns, priority tags, and model metadata.
   - **Kanban Board**: Drag-and-drop cards across `Backlog`, `In Progress`, `Review`, `Active`, and `Done` columns, automatically updating YAML frontmatter.
   - **Gallery View**: Card layout showcasing agents, skills, and projects with quick action buttons.

4. **Living AI Agent & Skill Hub**
   - Built-in **Agent Playground**: Select an agent or skill doc, inspect its system prompt and tools, and test prompts interactively.
   - One-click export to Antigravity Skill JSON format, Cursor rules, or Markdown.

5. **AI Intelligence Engine (Local & Cloud)**
   - **Local Ollama Support**: 100% private and offline inference via `http://localhost:11434`. Includes automated connection testing and model detection.
   - **Cloud APIs**: Google Gemini (`gemini-1.5-flash`, `gemini-1.5-pro`) and OpenAI (`gpt-4o-mini`, `gpt-4o`).
   - **Features**:
     - Executive Briefing, Key Bullet Points, and Action Checklist summarization.
     - Auto-Categorizer & Auto-Tagger with one-click application to document frontmatter.

6. **Global Task Rolodex**
   - Crawls all `- [ ]` and `- [x]` markdown checkboxes across every document in your vault.
   - Toggling tasks in the Rolodex immediately updates the exact line in the source markdown file on disk.

7. **Quick Jump Command Palette (`Ctrl + K`)**
   - Instant search across documents, tags, agents, and quick actions.

---

## Getting Started

### 1. Web Preview & Development Mode
To launch the app in your browser with hot module reload:
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173).

### 2. Launch as Native Desktop App (Electron)
To build and launch as a desktop window:
```bash
npm run build
npm start
```

### 3. Run Automated Tests
```bash
npm test
```

---

## Pre-Populated Sample Vault
The app comes with sample files to demonstrate all capabilities:
- `projects/project-nexus.md`: Roadmap with active checklists and frontmatter.
- `agents/senior-code-reviewer.md`: AI agent spec with system prompt and tools.
- `agents/executive-briefing-agent.md`: Executive summarizer agent.
- `skills/rag-vector-search.md`: AI Ops skill definition.
- `skills/markdown-pdf-exporter.md`: Export and publishing skill.
- `docs/architecture-adr-001.md`: Local-first architectural decision record.
