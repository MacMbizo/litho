import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KeyStore, type Cipher } from '../electron/ai/keyStore.ts';
import { AIGateway, DEFAULT_AI_CONFIG, normalizeConfig, type Providers } from '../electron/ai/gateway.ts';
import { checkOllamaUrl } from '../electron/ai/otherProviders.ts';
import { claudeSystem } from '../electron/ai/claude.ts';
import { systemWithPersona } from '../electron/ai/types.ts';
import { PERSONA_MAX_CHARS, createPersona, isPersonaId, listPersonas, ollamaContextFor, parsePersona, readPersona } from '../electron/ai/personas.ts';

/** Reversible stand-in for safeStorage: proves the file never holds the key in plain text. */
const fakeCipher = (available = true): Cipher => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf-8').map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf-8'),
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ai-'));

test('KeyStore encrypts keys, reports only set/last4, and clears', async () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'ai-keys.bin');
    const ks = new KeyStore(file, fakeCipher());
    assert.deepStrictEqual(await ks.status(), { claude: { set: false }, gemini: { set: false }, openai: { set: false } });
    await ks.set('claude', '  sk-ant-api03-SECRETVALUE1234  ');
    assert.ok(!fs.readFileSync(file).toString('utf-8').includes('SECRETVALUE'), 'not stored in plain text');
    assert.deepStrictEqual((await ks.status()).claude, { set: true, last4: '1234' });
    // A fresh instance reads it back through the cipher.
    assert.strictEqual(await new KeyStore(file, fakeCipher()).get('claude'), 'sk-ant-api03-SECRETVALUE1234');
    await ks.clear('claude');
    assert.strictEqual(await new KeyStore(file, fakeCipher()).get('claude'), undefined);
    await assert.rejects(ks.set('openai', 'has space inside'), /does not look like an API key/);
    await assert.rejects(new KeyStore(path.join(dir, 'x.bin'), fakeCipher(false)).set('gemini', 'AIzaKEY'), /no secure storage/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('normalizeConfig keeps known fields only and defaults Claude to Opus 5.5', () => {
  const c = normalizeConfig({ provider: 'bogus', models: { claude: '', openai: 'gpt-x', evil: 'y' }, ollamaUrl: 'file:///etc', apiKey: 'leak' });
  assert.strictEqual(c.provider, 'claude');
  assert.strictEqual(c.models.claude, 'claude-opus-5-5');
  assert.strictEqual(c.models.openai, 'gpt-x');
  assert.strictEqual(c.ollamaUrl, DEFAULT_AI_CONFIG.ollamaUrl);
  assert.ok(!('apiKey' in c) && !('evil' in (c.models as any)));
});

test('checkOllamaUrl accepts http(s) only', () => {
  assert.strictEqual(checkOllamaUrl('http://localhost:11434/'), 'http://localhost:11434');
  assert.throws(() => checkOllamaUrl('file:///c:/x'), /http/);
  assert.throws(() => checkOllamaUrl('not a url'), /valid URL/);
});

function fakeProviders(log: any[]): Providers {
  return {
    complete: async (provider, key, url, req) => {
      log.push({ provider, key, url, model: req.model, effort: req.effort, system: req.system });
      return { text: `answer from ${provider}`, model: req.model };
    },
    models: async (provider) => [{ id: `${provider}-m1`, label: 'M1' }],
  };
}

test('gateway routes by provider and task, needs a key for cloud providers, and never returns the key', async () => {
  const dir = tmp();
  try {
    const log: any[] = [];
    const keys = new KeyStore(path.join(dir, 'k.bin'), fakeCipher());
    const gw = new AIGateway(path.join(dir, 'ai-config.json'), keys, fakeProviders(log));

    await assert.rejects(gw.prompt('chat', 's', 'u'), /Add a Claude API key/);
    await keys.set('claude', 'sk-ant-xyz9');
    const r = await gw.prompt('categorize', 'sys', 'user');
    assert.strictEqual(r.provider, 'claude');
    assert.strictEqual(r.text, 'answer from claude');
    assert.deepStrictEqual(log[0], { provider: 'claude', key: 'sk-ant-xyz9', url: 'http://localhost:11434', model: 'claude-opus-5-5', effort: 'low', system: 'sys' });
    assert.ok(!JSON.stringify(r).includes('sk-ant-xyz9'), 'the result never carries the key');

    await gw.setConfig({ provider: 'ollama', models: { ollama: 'llama3.2:latest' } });
    const o = await gw.prompt('summarize', 's', 'u');
    assert.strictEqual(o.provider, 'ollama');
    assert.strictEqual(log[1].key, undefined, 'no key sent to a local model');
    assert.strictEqual(log[1].effort, 'medium');

    assert.deepStrictEqual((await gw.listModels('gemini')).error, 'Add a Gemini API key to list its models.');
    assert.strictEqual((await gw.listModels('claude')).models[0].id, 'claude-m1');
    assert.ok(!fs.readFileSync(path.join(dir, 'ai-config.json'), 'utf-8').includes('sk-ant'), 'settings file holds no keys');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migrateLegacy moves old localStorage keys into the store once, drops stale default models', async () => {
  const dir = tmp();
  try {
    const keys = new KeyStore(path.join(dir, 'k.bin'), fakeCipher());
    const gw = new AIGateway(path.join(dir, 'ai-config.json'), keys, fakeProviders([]));
    const legacy = {
      provider: 'gemini',
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'llama3:latest',
      geminiApiKey: 'AIzaOLDKEY',
      geminiModel: 'gemini-1.5-flash',
      openaiApiKey: '',
      openaiModel: 'gpt-4o-mini',
    };
    assert.deepStrictEqual(await gw.migrateLegacy(legacy), { movedKeys: ['gemini'] });
    assert.strictEqual(await keys.get('gemini'), 'AIzaOLDKEY');
    const c = await gw.getConfig();
    assert.strictEqual(c.provider, 'gemini');
    assert.strictEqual(c.models.gemini, '', 'retired 1.5 default not carried over');
    assert.strictEqual(c.models.ollama, '', 'old llama3 default not carried over');
    assert.strictEqual(c.models.openai, 'gpt-4o-mini');
    // A key already stored is never overwritten by a stale copy.
    await keys.set('gemini', 'AIzaNEWKEY');
    assert.deepStrictEqual(await gw.migrateLegacy({ geminiApiKey: 'AIzaOLDKEY' }), { movedKeys: [] });
    assert.strictEqual(await keys.get('gemini'), 'AIzaNEWKEY');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- Slice 2: personas and prompt caching ------------------------------------------

test('isPersonaId accepts plain .md file names only', () => {
  assert.ok(isPersonaId('Software architect.md'));
  for (const bad of ['../x.md', 'a/b.md', 'a\\b.md', '.hidden.md', 'notes.txt', 'C:x.md', '', 5]) assert.ok(!isPersonaId(bad), String(bad));
});

test('parsePersona takes the name from frontmatter, then the H1, then the file name', () => {
  const a = parsePersona('a.md', '---\nname: Architect\ndescription: Designs systems\n---\n\n# Ignored\n\nThink in boundaries.');
  assert.strictEqual(a.name, 'Architect');
  assert.strictEqual(a.description, 'Designs systems');
  assert.ok(!a.text.includes('name:'), 'frontmatter is not sent to the model');
  assert.strictEqual(parsePersona('b.md', '# Editor\n\nCut words.').name, 'Editor');
  assert.strictEqual(parsePersona('Plain one.md', 'just text here').name, 'Plain one');
  assert.strictEqual(parsePersona('c.md', 'one two three').words, 3);
});

test('listPersonas, createPersona (never overwrites) and readPersona errors', async () => {
  const dir = tmp();
  try {
    const folder = path.join(dir, 'Personas');
    assert.deepStrictEqual(await listPersonas(folder), [], 'no folder yet is fine');
    const id = await createPersona(folder, 'Software architect');
    assert.strictEqual(id, 'Software architect.md');
    fs.writeFileSync(path.join(folder, id), '# Mine\n\nKeep me.');
    assert.strictEqual(await createPersona(folder, 'Software architect'), 'Software architect 2.md');
    assert.strictEqual(fs.readFileSync(path.join(folder, id), 'utf-8'), '# Mine\n\nKeep me.', 'existing file untouched');
    assert.strictEqual(await createPersona(folder, 'a/b:c'), 'a b c.md', 'unsafe characters replaced');
    fs.writeFileSync(path.join(folder, 'ignore.txt'), 'x');
    const list = await listPersonas(folder);
    assert.deepStrictEqual(list.map((p) => p.id), ['a b c.md', 'Software architect 2.md', 'Software architect.md']);
    assert.ok(!('text' in list[0]), 'the list carries no persona text');
    await assert.rejects(readPersona(folder, 'gone.md'), /no longer in the Personas folder/);
    await assert.rejects(readPersona(folder, '../ai-config.md'), /not valid/);
    fs.writeFileSync(path.join(folder, 'empty.md'), '---\nname: Empty\n---\n');
    await assert.rejects(readPersona(folder, 'empty.md'), /is empty/);
    fs.writeFileSync(path.join(folder, 'huge.md'), 'x'.repeat(PERSONA_MAX_CHARS + 1));
    await assert.rejects(readPersona(folder, 'huge.md'), /too long/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('claudeSystem puts the persona first with a cache breakpoint, task instructions after it', () => {
  assert.strictEqual(claudeSystem({ system: 'task' }), 'task', 'no persona: a plain string, nothing cached');
  assert.deepStrictEqual(claudeSystem({ persona: 'P', system: 'task' }), [
    { type: 'text', text: 'P', cache_control: { type: 'ephemeral' } },
    { type: 'text', text: 'task' },
  ]);
  assert.strictEqual((claudeSystem({ persona: 'P', system: '  ' }) as any[]).length, 1, 'no empty text block');
  assert.strictEqual(systemWithPersona({ persona: 'P', system: 'task' }), 'P\n\n---\n\ntask');
  assert.strictEqual(systemWithPersona({ system: 'task' }), 'task');
});

test('ollamaContextFor fits the whole prompt, in 4k steps, between 16k and 128k', () => {
  assert.strictEqual(ollamaContextFor(1000), 16384);
  const ctx = ollamaContextFor(150_000); // ~20k-word persona
  assert.ok(ctx >= 150_000 / 3 + 4096 && ctx % 4096 === 0, String(ctx));
  assert.strictEqual(ollamaContextFor(5_000_000), 131072);
});

test('gateway sends the persona chosen for the task, honours overrides, and keeps choices in settings', async () => {
  const dir = tmp();
  try {
    const folder = path.join(dir, 'Personas');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'Architect.md'), '---\nname: The Architect\n---\nThink in boundaries.');
    const log: any[] = [];
    const providers: Providers = {
      complete: async (provider, _key, _url, req) => {
        log.push(req);
        return { text: 'ok', model: req.model };
      },
      models: async () => [],
    };
    const gw = new AIGateway(path.join(dir, 'ai-config.json'), new KeyStore(path.join(dir, 'k.bin'), fakeCipher()), providers, async () => folder);
    await gw.setConfig({ provider: 'ollama', models: { ollama: 'llama3.2' }, personas: { chat: 'Architect.md', summarize: '../evil.md', bogus: 'Architect.md' } });
    assert.deepStrictEqual((await gw.getConfig()).personas, { chat: 'Architect.md' }, 'only valid tasks and file names are kept');

    const r = await gw.prompt('chat', 'sys', 'q');
    assert.strictEqual(log[0].persona, 'Think in boundaries.');
    assert.strictEqual(log[0].system, 'sys');
    assert.deepStrictEqual(r.persona, { id: 'Architect.md', name: 'The Architect' });

    await gw.prompt('summarize', 'sys', 'q');
    assert.strictEqual(log[1].persona, undefined, 'no persona picked for summaries');
    const off = await gw.prompt('chat', 'sys', 'q', { persona: null });
    assert.strictEqual(log[2].persona, undefined);
    assert.strictEqual(off.persona, undefined, 'override turns it off');
    await gw.prompt('summarize', 'sys', 'q', { persona: 'Architect.md' });
    assert.strictEqual(log[3].persona, 'Think in boundaries.', 'override picks one');

    fs.rmSync(path.join(folder, 'Architect.md'));
    await assert.rejects(gw.prompt('chat', 'sys', 'q'), /no longer in the Personas folder/);
    assert.deepStrictEqual((await gw.listPersonas()).personas, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
