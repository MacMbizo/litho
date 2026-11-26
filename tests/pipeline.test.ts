import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ProjectIndex, VectorCache, chunkDoc, keywordSearch, MAX_CHUNKS_PER_DOC, type PipelineDoc } from '../electron/ai/finder.ts';
import { CardCache, WHOLE_DOC_CHARS, condense, excerptCard } from '../electron/ai/condenser.ts';
import { ProjectChat, buildUserMessage, validateDocs, type OllamaDeps } from '../electron/ai/projectChat.ts';
import { AIGateway, type Providers } from '../electron/ai/gateway.ts';
import { KeyStore, type Cipher } from '../electron/ai/keyStore.ts';
import { MAX_TOOL_ROUNDS, claudeConverse } from '../electron/ai/claude.ts';
import { projectFactsForAI } from '../src/services/projectFacts.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-'));
const cipher: Cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s, 'utf-8'),
  decryptString: (b) => b.toString('utf-8'),
};

const doc = (id: string, body: string, title = id): PipelineDoc => ({ id, path: `docs/${id}.md`, title, body });

/** A deterministic stand-in for an embedding model: counts of a few topic words. */
const TOPICS = ['database', 'login', 'deploy', 'design', 'payment', 'query', 'document'];
const fakeEmbed = (calls: string[][]) => async (inputs: string[]) => {
  calls.push(inputs);
  return inputs.map((t) => TOPICS.map((w) => (t.toLowerCase().split(w).length - 1) + 0.01));
};

test('chunkDoc: title first, frontmatter dropped, capped chunk count', () => {
  const body = `---\ntitle: X\n---\n# Intro\n\nHello there.\n\n${'Long paragraph. '.repeat(1000)}`;
  const chunks = chunkDoc({ title: 'My doc', path: 'docs/a.md', body });
  assert.ok(chunks[0].startsWith('My doc (docs/a.md)'));
  assert.ok(!chunks.join('').includes('title: X'));
  assert.strictEqual(chunks.length, MAX_CHUNKS_PER_DOC);
  assert.ok(chunks.every((c) => c.length <= 1500));
  assert.strictEqual(chunkDoc({ title: 't', path: 'p', body: '' }).length, 1, 'an empty doc still has its title');
});

test('VectorCache round-trips float32 vectors', async () => {
  const dir = tmp();
  try {
    const cache = new VectorCache(dir);
    assert.strictEqual(await cache.get('m', 'ab12'), null);
    await cache.set('nomic-embed-text:latest', 'ab12', [
      [1, 2, 3],
      [4, 5, 6],
    ]);
    const back = await cache.get('nomic-embed-text:latest', 'ab12');
    assert.deepStrictEqual(back!.map((v) => Array.from(v)), [
      [1, 2, 3],
      [4, 5, 6],
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ProjectIndex embeds once (cache by content), ranks by meaning, and finds docs by path', async () => {
  const dir = tmp();
  try {
    const cache = new VectorCache(dir);
    const docs = [doc('db', 'The database schema and query plans.'), doc('auth', 'Login flow and sessions.'), doc('ship', 'How we deploy to production.')];
    const calls: string[][] = [];
    const progress: number[] = [];
    const a = new ProjectIndex(docs);
    await a.embedAll('m', fakeEmbed(calls), cache, (p) => progress.push(p.done));
    assert.strictEqual(a.mode, 'embeddings');
    assert.ok(calls[0].every((t) => t.startsWith('search_document: ')));
    assert.strictEqual(progress.at(-1), 3);
    const hits = await a.search('how do I deploy?', 2, fakeEmbed(calls));
    assert.strictEqual(hits[0].doc.id, 'ship');
    assert.ok(calls.at(-1)![0].startsWith('search_query: '));

    const calls2: string[][] = [];
    const b = new ProjectIndex([...docs, doc('new', 'Payment provider notes.')]);
    await b.embedAll('m', fakeEmbed(calls2), cache);
    assert.strictEqual(calls2.length, 1, 'only the new doc is embedded');
    assert.strictEqual(calls2[0].length, chunkDoc(docs[0]).length);

    assert.strictEqual(a.find('DOCS\\db.md')?.id, 'db', 'path lookup ignores case and slash style');
    assert.strictEqual(a.find('./docs/auth.md')?.id, 'auth');
    assert.strictEqual(a.find('nope.md'), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('keywordSearch: titles weigh more than body mentions; stop words ignored', () => {
  const docs = [doc('a', 'deploy deploy deploy'), doc('deploy-guide', 'steps'), doc('c', 'nothing here')];
  const hits = keywordSearch(docs, 'what is the deploy process', 5);
  assert.deepStrictEqual(
    hits.map((h) => h.doc.id),
    ['deploy-guide', 'a']
  );
  assert.deepStrictEqual(keywordSearch(docs, 'the and of', 5), []);
});

test('condense: short docs whole, long docs carded once (cached), excerpts when the model fails', async () => {
  const dir = tmp();
  try {
    const cache = new CardCache(dir);
    const long = doc('long', `# Plan\n\n## Database\n\n${'We store orders in Postgres. '.repeat(200)}\n\n## Login\n\nUsers sign in with magic links.`);
    const short = doc('short', 'Short note.');
    assert.ok(long.body.length > WHOLE_DOC_CHARS);
    let writes = 0;
    const write = async () => (writes++, 'CARD: orders in Postgres');
    const first = await condense([short, long], 'how do users sign in', { model: 'llama3.2:latest', write, cache });
    assert.deepStrictEqual(
      first.map((c) => c.kind),
      ['whole', 'card']
    );
    assert.strictEqual(first[1].text, 'CARD: orders in Postgres');
    await condense([long], 'q', { model: 'llama3.2:latest', write, cache });
    assert.strictEqual(writes, 1, 'the card is cached by content');

    const failing = await condense([doc('other', 'x '.repeat(3000) + '\n\nUsers sign in with magic links here.')], 'how do users sign in', {
      model: 'm',
      write: async () => {
        throw new Error('down');
      },
      cache,
    });
    assert.strictEqual(failing[0].kind, 'excerpt');
    assert.ok(excerptCard(long, 'how do users sign in').includes('magic links'));
    assert.ok(excerptCard(long, 'q').startsWith('Sections: Plan · Database · Login'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildUserMessage: facts, labelled docs, other docs to read, the question last', () => {
  const long = doc('long', 'L'.repeat(20000));
  const msg = buildUserMessage({
    facts: '- Doc health: grade B',
    question: 'Why?',
    condensed: [
      { doc: doc('a', 'A body'), kind: 'whole', text: 'A body' },
      { doc: long, kind: 'card', text: 'A card' },
    ],
    others: [doc('z', 'z')],
  });
  assert.ok(msg.startsWith('## Project facts (from DocAtlas)\n\n- Doc health: grade B'));
  assert.ok(msg.includes('### docs/a.md (full text)') && msg.includes('### docs/long.md (doc card)'));
  assert.ok(msg.includes('## Other documents in the project\n\n- docs/z.md'));
  assert.ok(msg.trimEnd().endsWith('## Question\n\nWhy?'));
  const inlined = buildUserMessage({ facts: '', question: 'q', condensed: [{ doc: long, kind: 'card', text: 'A card' }], others: [], inline: { count: 1, maxChars: 100 } });
  assert.ok(inlined.includes('### docs/long.md (full text, cut)') && !inlined.includes('A card'));
});

test('validateDocs rejects bad shapes and oversized projects', () => {
  assert.throws(() => validateDocs('x'), /Invalid document list/);
  assert.throws(() => validateDocs([{ id: 1 }]), /Invalid document/);
  assert.strictEqual(validateDocs([{ id: 'a', path: 'a.md', body: 'b' }])[0].title, 'a.md');
  assert.throws(() => validateDocs(Array(10001).fill({ id: 'a', path: 'a', body: '' })), /more than 10,000/);
});

function chatSetup(providers: Providers, ollama: Partial<OllamaDeps>) {
  const dir = tmp();
  const gw = new AIGateway(path.join(dir, 'c.json'), new KeyStore(path.join(dir, 'k.bin'), cipher), providers);
  const deps: OllamaDeps = {
    installed: async () => ['nomic-embed-text:latest', 'llama3.2:latest'],
    embed: async (_u, _m, inputs) => fakeEmbed([])(inputs),
    write: async () => 'CARD',
    ...ollama,
  };
  return { dir, gw, chat: new ProjectChat(gw, path.join(dir, 'cache'), deps) };
}

const projectDocs = [
  doc('db', `# Database\n\nThe database is Postgres. ${'Query details. '.repeat(400)}`, 'Database design'),
  doc('auth', 'Login uses magic links.', 'Login'),
  doc('ship', 'We deploy with Vercel.', 'Deploy'),
];

test('ProjectChat on Claude: finds, cards, lets Claude read a doc, and reports sources', async () => {
  const seen: any[] = [];
  const providers: Providers = {
    complete: async () => {
      throw new Error('not used');
    },
    models: async () => [],
    converse: async (_key, req, read) => {
      seen.push(req);
      const r = read('docs/db.md');
      assert.ok(!('error' in r) && r.text.includes('Postgres'));
      assert.ok('error' in read('../secret.md'));
      return { text: 'It is Postgres.', model: req.model, read: ['docs/db.md'], usage: { input: 1, output: 1, cacheRead: 900 } };
    },
  };
  const { dir, gw, chat } = chatSetup(providers, {});
  try {
    await new KeyStore(path.join(dir, 'k.bin'), cipher).set('claude', 'sk-ant-x');
    const progress: string[] = [];
    const s = await chat.index('P', projectDocs, (p) => progress.push(p.stage));
    assert.deepStrictEqual(s, { docs: 3, mode: 'embeddings' });
    const r = await chat.ask('P', { projectName: 'Demo', question: 'Which database do we use?', history: [{ role: 'user', text: 'hi' }], facts: '- Doc health: grade A' }, (p) =>
      progress.push(p.stage)
    );
    assert.strictEqual(r.text, 'It is Postgres.');
    assert.strictEqual(r.provider, 'claude');
    assert.strictEqual(seen[0].history.length, 1);
    assert.ok(seen[0].system.includes('"Demo"') && seen[0].user.includes('- Doc health: grade A'));
    assert.ok(seen[0].user.includes('### docs/db.md (doc card)\nTitle: Database design\n\nCARD'), 'long doc sent as its card');
    assert.ok(seen[0].user.includes('### docs/auth.md (full text)'), 'short doc sent whole');
    assert.strictEqual(r.sources.find((x) => x.id === 'db')?.kind, 'read', 'a doc Claude read is marked');
    assert.strictEqual(r.cardModel, 'llama3.2:latest');
    assert.ok(['index', 'find', 'cards', 'think'].every((st) => progress.includes(st)));
    await gw.setConfig({ provider: 'claude' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ProjectChat without Ollama: keywords, excerpts, and other providers get top docs inlined', async () => {
  const seen: any[] = [];
  const providers: Providers = {
    complete: async (_p, _k, _u, req) => (seen.push(req), { text: 'ok', model: req.model }),
    models: async () => [],
  };
  const { dir, gw, chat } = chatSetup(providers, { installed: async () => null });
  try {
    await gw.setConfig({ provider: 'ollama', models: { ollama: 'llama3.2:latest' } });
    const s = await chat.index('P', projectDocs);
    assert.strictEqual(s.mode, 'keywords');
    assert.match(s.reason!, /Ollama is not running/);
    const r = await chat.ask('P', { projectName: 'Demo', question: 'database query', history: [{ role: 'assistant', text: 'earlier' }], facts: '' });
    assert.strictEqual(r.mode, 'keywords');
    assert.ok(seen[0].user.includes('### docs/db.md (full text)'), 'no read_doc: the top doc is inlined');
    assert.ok(seen[0].user.startsWith('Your earlier answer:\nearlier'), 'history is folded into the prompt');
    await assert.rejects(chat.ask('other', { projectName: 'x', question: 'q', history: [], facts: '' }), /not indexed yet/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ProjectChat says how to get matching by meaning when the embedding model is missing', async () => {
  const { dir, chat } = chatSetup({ complete: async () => ({ text: '', model: '' }), models: async () => [] }, { installed: async () => ['llama3.2:latest'] });
  try {
    assert.match((await chat.index('P', projectDocs)).reason!, /ollama pull nomic-embed-text/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- The real SDK tool loop against a local stub of the Messages API (no key, no network) -----------

function sse(events: any[]): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}
const start = (usage = { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 }) => ({
  type: 'message_start',
  message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage },
});
const toolTurn = (id: string, docPath: string) =>
  sse([
    start(),
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name: 'read_doc', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ path: docPath }) } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ]);
const textTurn = (text: string) =>
  sse([
    start(),
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ]);

async function withStub(reply: (body: any, n: number) => string, run: () => Promise<void>): Promise<any[]> {
  const bodies: any[] = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const body = JSON.parse(b);
      bodies.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(reply(body, bodies.length));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const old = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    await run();
  } finally {
    if (old === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = old;
    await new Promise((r) => server.close(r));
  }
  return bodies;
}

const converseReq = { system: 'TASK', persona: 'PERSONA', user: 'QUESTION', history: [{ role: 'user' as const, text: 'earlier q' }, { role: 'assistant' as const, text: 'earlier a' }], model: 'claude-opus-5-5', effort: 'medium' as const };

test('claudeConverse: read_doc round trip on the wire, usage summed, docs read reported', async () => {
  let result: any;
  const bodies = await withStub(
    (_b, n) => (n === 1 ? toolTurn('toolu_1', 'docs/db.md') : textTurn('Postgres.')),
    async () => {
      result = await claudeConverse('sk-ant-fake', converseReq, (ref) => (ref === 'docs/db.md' ? { path: 'docs/db.md', text: 'DB TEXT' } : { error: 'no' }));
    }
  );
  assert.strictEqual(bodies.length, 2);
  const [first, second] = bodies;
  assert.deepStrictEqual(first.system[0], { type: 'text', text: 'PERSONA', cache_control: { type: 'ephemeral' } });
  assert.deepStrictEqual(first.cache_control, { type: 'ephemeral' }, 'automatic caching for the message tail');
  assert.strictEqual(first.tools[0].name, 'read_doc');
  assert.strictEqual(first.tools[0].eager_input_streaming, true);
  assert.deepStrictEqual(first.tool_choice, { type: 'auto' });
  assert.deepStrictEqual(
    first.messages.map((m: any) => m.role),
    ['user', 'assistant', 'user']
  );
  // The assistant's tool_use goes back unchanged, then the tool result.
  assert.strictEqual(second.messages[3].content[0].type, 'tool_use');
  assert.deepStrictEqual(second.messages[3].content[0].input, { path: 'docs/db.md' });
  const tr = second.messages[4].content[0];
  assert.strictEqual(tr.type, 'tool_result');
  assert.strictEqual(tr.tool_use_id, 'toolu_1');
  assert.strictEqual(tr.content, 'docs/db.md\n\nDB TEXT');
  assert.strictEqual(result.text, 'Postgres.');
  assert.deepStrictEqual(result.read, ['docs/db.md']);
  assert.deepStrictEqual(result.usage, { input: 200, output: 25, cacheRead: 100, cacheWrite: 20 });
});

test('claudeConverse: an unknown doc is an error result, and the loop ends after MAX_TOOL_ROUNDS', async () => {
  let result: any;
  const bodies = await withStub(
    (body) => (body.tool_choice?.type === 'none' ? textTurn('Done with what I have.') : toolTurn(`toolu_${Math.random()}`, 'missing.md')),
    async () => {
      result = await claudeConverse('sk-ant-fake', converseReq, () => ({ error: 'No document "missing.md".' }));
    }
  );
  assert.strictEqual(bodies.length, MAX_TOOL_ROUNDS + 1);
  assert.deepStrictEqual(bodies.at(-1).tool_choice, { type: 'none' });
  assert.strictEqual(bodies[1].messages.at(-1).content[0].is_error, true);
  assert.strictEqual(result.text, 'Done with what I have.');
  assert.deepStrictEqual(result.read, []);
});

test('projectFactsForAI: a short brief from the audit, freshness and basics', () => {
  const report: any = {
    grade: 'B',
    healthScore: 78,
    inventory: [
      { path: 'README.md', status: 'canonical', canonicalScore: 9, brokenLinks: [] },
      { path: 'docs/old.md', status: 'stale', canonicalScore: 1, brokenLinks: ['x.md'] },
      { path: 'docs/copy.md', status: 'duplicate', duplicateOf: 'README.md', canonicalScore: 0, brokenLinks: [] },
    ],
    counts: { canonical: 1, healthy: 0, 'module-doc': 0, stale: 1, duplicate: 1, deprecated: 0, orphan: 0, 'agent-system': 0 },
    missingDocs: [{ title: 'Architecture', priority: 'critical' }],
    stackProfile: { frameworks: ['Expo'], expoSdkVersion: '52', packageManager: 'pnpm', configFilesFound: [], scripts: {}, dependencies: [] },
  };
  const facts = projectFactsForAI({
    name: 'Demo',
    report,
    freshness: { score: 60, level: 'aging', headline: 'Aging', issues: [{ severity: 'outdated', title: 'Expo SDK 52 → 54' } as any], counts: {} as any },
    basics: { level: 'partial', passed: 2, checks: [{ status: 'fail', chip: 'No remote', label: 'Remote' } as any], description: { text: 'A demo app.', source: 'README.md' } },
  });
  assert.ok(facts.startsWith('- Project: Demo: A demo app.'));
  assert.ok(facts.includes('grade B (78/100), 3 docs: 1 canonical, 1 stale, 1 duplicate.'));
  assert.ok(facts.includes('Authoritative docs: README.md.'));
  assert.ok(facts.includes('docs/copy.md (copy of README.md)'));
  assert.ok(facts.includes('Missing docs: Architecture (critical).'));
  assert.ok(facts.includes('Stack: Expo; Expo SDK 52; pnpm.'));
  assert.ok(facts.includes('Stack freshness: Aging (60/100). Top issues: Expo SDK 52 → 54.'));
  assert.ok(facts.includes('missing or weak: No remote'));
});
