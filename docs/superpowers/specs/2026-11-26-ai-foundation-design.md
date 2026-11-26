# AI foundation (project 2): design

_2026-11-26. This is project 2 in the owner's order (stack fixer → **AI foundation** → design suite). The roadmap is in HANDOFF.md._

## Where it starts

- **Code:** `src/services/aiService.ts` calls Ollama, Gemini and OpenAI **from the renderer**.
- **Keys:** stored in `localStorage` (`notion_markdown_ai_config`). The Gemini key is sent **in the URL**.
- **Models:** the lists are out of date (Gemini 1.5, gpt-4o-mini). There is no Claude.
- **Context limits:** project chat sends the top 4 docs × 2,000 chars, summarize sends 15k chars, and categorize sends 8k.
- **This machine:** Ollama 0.40 is running with `nomic-embed-text`, `mxbai-embed-large`, `llama3.2` (3B), `qwen3-coder:30b` and others. The GPU is an RTX 4060 with 8 GB.

## Slice 1: a secure gateway (this change)

- **All model calls run in the main process.** Code lives in `electron/ai/`. The renderer sends `ai:prompt { system, user, providerOverride? }` and gets text back. Keys never enter the renderer again.
- **Keys go in Electron `safeStorage`** (Windows DPAPI), in `userData/docatlas/ai-keys.bin`.
  - The renderer can only *set*, *clear*, or see that a key is set, plus its last 4 characters.
  - The first run migrates any keys found in the old `localStorage` config, then blanks them there.
- **Providers:**
  - **Claude**, through the official `@anthropic-ai/sdk`, in its own module.
    - Default `claude-opus-5-5`, with `claude-sonnet-5-5` and `claude-haiku-5-5` offered.
    - Uses adaptive thinking, with `effort` set per task: `low` for categorize, `medium` for summaries and chat.
    - Has the server-side refusal fallback (`fallbacks: "default"`).
    - `stop_reason` is checked before the content is read.
  - **Gemini:** the key goes in the `x-goog-api-key` header (not the URL). The model list comes live from `GET /v1beta/models`.
  - **OpenAI:** the model list comes live from `GET /v1/models`.
  - **Ollama:** `/api/chat`, with `num_ctx` raised to 16k so a big prompt isn't silently cut.
- **Model lists are fetched, not hardcoded.** Claude's comes from the Models API. Each provider has a sensible default, shown until the live list arrives.
- **Browser dev build:** Ollama only, called directly; cloud providers say "desktop app only". No keys are stored in the browser.
- **Settings modal:** Claude becomes the first provider. Key fields are write-only and show "•••• abcd" once set. Models come from the live list.

## Slice 2: personas and prompt caching (built 2026-11-26)

- **Personas:** Markdown files in a `Personas` folder (in the Notes home), chosen per task. Each is 10–20k words.
- **Caching:** the persona goes in a cached `system` block (`cache_control`). The volatile parts (task, docs) come after it, so a cached persona costs about $0.005 per request on Opus 5.5. The `usage.cache_read_input_tokens` field is shown so the caching can be verified.
- **Ollama:** `num_ctx` is sized to the persona.

## Slice 3: the finder → condenser → thinker pipeline (built 2026-11-26)

- **Finder:** Ollama `nomic-embed-text` embeddings of each doc, cached by content hash in `userData/docatlas/embeddings/`. It picks the relevant docs.
- **Condenser:** `llama3.2` writes a "doc card" per file, also cached by content hash.
- **Thinker:** Claude or Gemini gets the persona, DocAtlas's audit facts and the cards, and asks for a doc's full text on demand (a tool).
- **This replaces** project chat's top 4 × 2,000 chars.

## Not in scope

- Agents and tool loops beyond "ask for a doc's full text".
- Usage and cost dashboards.
- Data leaving the machine without the owner choosing a cloud provider. Ollama stays the default for local-only work.
