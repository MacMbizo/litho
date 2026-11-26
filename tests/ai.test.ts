import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KeyStore, type Cipher } from '../electron/ai/keyStore.ts';
import { AIGateway, DEFAULT_AI_CONFIG, normalizeConfig, type Providers } from '../electron/ai/gateway.ts';
import { checkOllamaUrl } from '../electron/ai/otherProviders.ts';

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
