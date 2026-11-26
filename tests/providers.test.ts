import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  GEMINI_MAX_TOOL_ROUNDS,
  geminiComplete,
  geminiConverse,
  ollamaComplete,
  openrouterComplete,
  openrouterModels,
  setGeminiBaseForTests,
  setOpenRouterBaseForTests,
  suggestGeminiModel,
  suggestOllamaModel,
} from '../electron/ai/otherProviders.ts';
import { AIGateway, type Providers } from '../electron/ai/gateway.ts';
import { KeyStore, type Cipher } from '../electron/ai/keyStore.ts';

const cipher: Cipher = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prov-'));

/** A local HTTP stub: records each request (url, headers, JSON body) and answers with reply(). */
async function stub(reply: (body: any, n: number, url: string) => { status?: number; json: any }, run: (base: string) => Promise<void>) {
  const seen: Array<{ url: string; headers: http.IncomingHttpHeaders; body: any }> = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = b ? JSON.parse(b) : null;
      seen.push({ url: req.url || '', headers: req.headers, body });
      const r = reply(body, seen.length, req.url || '');
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    await run(`http://127.0.0.1:${(server.address() as any).port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
  return seen;
}

const callTurn = (id: string | undefined, p: string) => ({
  candidates: [
    {
      content: { role: 'model', parts: [{ functionCall: { ...(id ? { id } : {}), name: 'read_doc', args: { path: p } }, thoughtSignature: 'SIG-1' }] },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 5, cachedContentTokenCount: 40 },
  modelVersion: 'gemini-3.8-flash',
});
const textTurn = (text: string) => ({
  candidates: [{ content: { role: 'model', parts: [{ text: 'my private reasoning', thought: true }, { text }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 20 },
  modelVersion: 'gemini-3.8-flash',
});

const req = {
  persona: 'PERSONA',
  system: 'TASK',
  user: 'QUESTION',
  history: [
    { role: 'user' as const, text: 'earlier q' },
    { role: 'assistant' as const, text: 'earlier a' },
  ],
  model: 'gemini-3.8-flash',
  effort: 'medium' as const,
};

test('geminiConverse: read_doc as a function call, model turn echoed with its signature, results matched by id', async () => {
  let result: any;
  const seen = await stub(
    (_b, n) => ({ json: n === 1 ? callTurn('call-1', 'docs/db.md') : textTurn('It is Postgres.') }),
    async (base) => {
      setGeminiBaseForTests(base);
      result = await geminiConverse('AIzaKEY', req, (ref) => (ref === 'docs/db.md' ? { path: 'docs/db.md', text: 'DB TEXT' } : { error: 'no' }));
    }
  );
  assert.strictEqual(seen.length, 2);
  const [first, second] = seen;
  assert.strictEqual(first.url, '/models/gemini-3.8-flash:generateContent');
  assert.strictEqual(first.headers['x-goog-api-key'], 'AIzaKEY', 'key in a header');
  assert.ok(!first.url.includes('AIza'), 'never in the URL');
  assert.strictEqual(first.body.systemInstruction.parts[0].text, 'PERSONA\n\n---\n\nTASK');
  assert.deepStrictEqual(
    first.body.contents.map((c: any) => c.role),
    ['user', 'model', 'user']
  );
  assert.strictEqual(first.body.tools[0].functionDeclarations[0].name, 'read_doc');
  // The model's turn goes back unchanged (thought signature included), then the result in a user turn.
  assert.deepStrictEqual(second.body.contents[3], callTurn('call-1', 'docs/db.md').candidates[0].content);
  assert.deepStrictEqual(second.body.contents[4], {
    role: 'user',
    parts: [{ functionResponse: { id: 'call-1', name: 'read_doc', response: { path: 'docs/db.md', content: 'DB TEXT' } } }],
  });
  assert.strictEqual(result.text, 'It is Postgres.', 'thought parts are not part of the answer');
  assert.deepStrictEqual(result.read, ['docs/db.md']);
  assert.deepStrictEqual(result.usage, { input: 300, output: 35, cacheRead: 40 });
  assert.strictEqual(result.model, 'gemini-3.8-flash');
});

test('geminiConverse: unknown docs are errors, and the loop ends after the round limit', async () => {
  let result: any;
  const seen = await stub(
    () => ({ json: callTurn(undefined, 'missing.md') }),
    async (base) => {
      setGeminiBaseForTests(base);
      result = await geminiConverse('AIzaKEY', req, () => ({ error: 'No document "missing.md".' }));
    }
  );
  assert.strictEqual(seen.length, GEMINI_MAX_TOOL_ROUNDS + 2, 'limit rounds, one "answer now" round, then stop');
  const firstResult = seen[1].body.contents.at(-1).parts[0].functionResponse;
  assert.deepStrictEqual(firstResult, { name: 'read_doc', response: { error: 'No document "missing.md".' } }, 'no id when the call had none');
  assert.match(seen.at(-1)!.body.contents.at(-1).parts[0].functionResponse.response.error, /Answer now/);
  assert.strictEqual(result.text, '');
});

test('geminiComplete: blocked and empty answers become plain errors; HTTP errors are friendly', async () => {
  await stub(
    (_b, n) =>
      n === 1
        ? { json: { promptFeedback: { blockReason: 'SAFETY' } } }
        : n === 2
          ? { json: { candidates: [{ finishReason: 'RECITATION' }] } }
          : { status: 403, json: { error: { message: 'API key not valid' } } },
    async (base) => {
      setGeminiBaseForTests(base);
      const r = { system: 's', user: 'u', model: 'gemini-3.8-flash', effort: 'low' as const };
      await assert.rejects(geminiComplete('k', r), /no answer \(blocked: SAFETY\)/);
      await assert.rejects(geminiComplete('k', r), /stopped without an answer \(RECITATION\)/);
      await assert.rejects(geminiComplete('k', r), /Gemini rejected the API key/);
    }
  );
});

test('suggestGeminiModel picks the newest stable Flash from the live list, never previews or lite', () => {
  // Model ids from Google's models page, 2026-11-26.
  const live = [
    'gemini-4-carbon',
    'gemini-4-hydrogen',
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-image',
    'gemini-3-flash-preview',
    'gemini-3.1-pro-preview',
    'gemini-2.5-flash',
    'gemini-omni-1.2-flash',
    'gemini-3.5-transcribe',
  ].map((id) => ({ id, label: id }));
  assert.strictEqual(suggestGeminiModel(live), 'gemini-3.8-flash');
  assert.strictEqual(suggestGeminiModel([{ id: 'gemini-4-hydrogen', label: '' }, { id: 'gemini-5-flash-preview', label: '' }]), 'gemini-4-hydrogen');
  assert.strictEqual(suggestGeminiModel([]), undefined);
});

test('suggestOllamaModel: largest general model that fits 8 GB, never a coder or reasoning model', () => {
  // This machine's installed models (2026-11-26), labels as ollamaModels builds them.
  const installed = [
    { id: 'hf.co/unsloth/DeepSeek-R1-Distill-Qwen-32B-GGUF:Q5_K_M', label: 'hf.co/unsloth/DeepSeek-R1-Distill-Qwen-32B-GGUF:Q5_K_M (32.8B)' },
    { id: 'hf.co/apto-as/Qwen2.5-Coder-14B-Instruct-Q5_K_M-GGUF:Q5_K_M', label: 'x (14.8B)' },
    { id: 'qwen3-coder:30b', label: 'qwen3-coder:30b (30.5B)' },
    { id: 'llama3.2:latest', label: 'llama3.2:latest (3.2B)' },
  ];
  assert.strictEqual(suggestOllamaModel(installed), 'llama3.2:latest');
  assert.strictEqual(suggestOllamaModel([...installed, { id: 'qwen3:8b', label: 'qwen3:8b (8.2B)' }]), 'qwen3:8b');
  assert.strictEqual(
    suggestOllamaModel([...installed, { id: 'qwen3:8b', label: 'qwen3:8b (8.2B)' }, { id: 'qwen3.5:4b', label: 'qwen3.5:4b (4.7B)' }]),
    'qwen3.5:4b',
    'the measured favourite beats a bigger model'
  );
  assert.strictEqual(suggestOllamaModel(installed.slice(0, 3)), 'hf.co/apto-as/Qwen2.5-Coder-14B-Instruct-Q5_K_M-GGUF:Q5_K_M', 'only specials: the smallest');
});

test('gateway picks and remembers a Gemini model when none is set; asks for one when it cannot', async () => {
  const dir = tmp();
  try {
    const log: any[] = [];
    let models = [{ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }, { id: 'gemini-3-flash-preview', label: 'p' }];
    const providers: Providers = {
      complete: async (_p, _k, _u, r) => (log.push(r), { text: 'ok', model: r.model }),
      models: async () => models,
    };
    const keys = new KeyStore(path.join(dir, 'k.bin'), cipher);
    const gw = new AIGateway(path.join(dir, 'c.json'), keys, providers);
    await gw.setConfig({ provider: 'gemini' });
    await assert.rejects(gw.prompt('chat', 's', 'u'), /Add a Gemini API key/);
    await keys.set('gemini', 'AIzaKEY');
    assert.strictEqual((await gw.listModels('gemini')).suggested, 'gemini-3.8-flash');
    await gw.prompt('chat', 's', 'u');
    assert.strictEqual(log[0].model, 'gemini-3.8-flash');
    assert.strictEqual((await gw.getConfig()).models.gemini, 'gemini-3.8-flash', 'remembered');
    models = [];
    await gw.setConfig({ provider: 'gemini', models: { gemini: '' } });
    await assert.rejects(gw.prompt('chat', 's', 'u'), /Pick a Gemini model/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gateway uses Gemini\'s read_doc loop for the thinker, and inlines docs for Ollama', async () => {
  const dir = tmp();
  try {
    const used: string[] = [];
    const providers: Providers = {
      complete: async (p, _k, _u, r) => (used.push(`complete:${p}`), { text: r.user, model: r.model }),
      models: async () => [],
      converse: { gemini: async (_k, r) => (used.push('converse:gemini'), { text: 'tooled', model: r.model }) },
    };
    const keys = new KeyStore(path.join(dir, 'k.bin'), cipher);
    await keys.set('gemini', 'AIzaKEY');
    const gw = new AIGateway(path.join(dir, 'c.json'), keys, providers);
    await gw.setConfig({ provider: 'gemini', models: { gemini: 'gemini-3.8-flash', ollama: 'llama3.2:latest' } });
    const g = await gw.converse('chat', 's', 'u', [], () => ({ error: 'x' }), () => 'INLINED');
    assert.strictEqual(g.text, 'tooled');
    await gw.setConfig({ provider: 'ollama', models: { gemini: 'gemini-3.8-flash', ollama: 'llama3.2:latest' } });
    const o = await gw.converse('chat', 's', 'u', [], () => ({ error: 'x' }), () => 'INLINED');
    assert.strictEqual(o.text, 'INLINED');
    assert.deepStrictEqual(used, ['converse:gemini', 'complete:ollama']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('OpenRouter: priced text-model list, Bearer key, out-of-credit and in-body errors explained', async () => {
  const seen = await stub(
    (_b, n, url) => {
      if (url === '/models')
        return {
          json: {
            data: [
              { id: 'acme/big', name: 'Acme Big', pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { output_modalities: ['text'] } },
              { id: 'acme/free', name: 'Acme Free', pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['text'] } },
              { id: 'acme/painter', name: 'Acme Painter', pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['image'] } },
            ],
          },
        };
      if (n === 2) return { json: { model: 'acme/big', choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 2 } } };
      if (n === 3) return { status: 402, json: { error: { message: 'Insufficient credits' } } };
      return { json: { error: { message: 'Upstream provider unavailable' } } };
    },
    async (base) => {
      setOpenRouterBaseForTests(base);
      assert.deepStrictEqual(await openrouterModels('sk-or-KEY'), [
        { id: 'acme/big', label: 'Acme Big · $3/$15 per M' },
        { id: 'acme/free', label: 'Acme Free · free' },
      ]);
      const r = { system: 's', user: 'u', model: 'acme/big', effort: 'low' as const };
      assert.strictEqual((await openrouterComplete('sk-or-KEY', r)).text, 'hi');
      await assert.rejects(openrouterComplete('sk-or-KEY', r), /OpenRouter: this key has run out of credit/);
      await assert.rejects(openrouterComplete('sk-or-KEY', r), /OpenRouter: Upstream provider unavailable/);
      await assert.rejects(openrouterComplete('sk-or-KEY', { ...r, model: '' }), /Pick an OpenRouter model/);
    }
  );
  assert.strictEqual(seen[1].headers.authorization, 'Bearer sk-or-KEY');
  assert.strictEqual(seen[1].url, '/chat/completions');
});

test('ollamaComplete: thinking off for low/medium effort; on for high, retried without on models that cannot think', async () => {
  const seen = await stub(
    (body) =>
      body.think === true ? { status: 400, json: { error: '"llama3.2:latest" does not support thinking' } } : { json: { message: { content: 'ok' }, model: body.model } },
    async (base) => {
      const r = { system: 's', user: 'u', model: 'llama3.2:latest' };
      assert.strictEqual((await ollamaComplete(base, { ...r, effort: 'medium' })).text, 'ok');
      assert.strictEqual((await ollamaComplete(base, { ...r, effort: 'high' })).text, 'ok');
    }
  );
  assert.deepStrictEqual(
    seen.map((s) => s.body.think),
    [false, true, undefined]
  );
});

test('ollamaComplete turns a GPU out-of-memory failure into a plain sentence', async () => {
  await stub(
    () => ({ status: 500, json: { error: 'llama-server reported out-of-memory during startup: CUDA error: out of memory' } }),
    async (base) => {
      await assert.rejects(ollamaComplete(base, { system: 's', user: 'u', model: 'qwen3-coder:30b', effort: 'low' }), /Ollama ran out of memory loading qwen3-coder:30b/);
    }
  );
});
