/**
 * API keys for cloud AI providers, encrypted with the OS keychain (Electron safeStorage: DPAPI on Windows).
 * Keys stay in the main process: the renderer can set or clear one and learn whether it's set (with the
 * last four characters), never read it back. Node only, with the cipher injected so tests can run it.
 */
import fs from 'fs';
import path from 'path';

export const CLOUD_PROVIDERS = ['claude', 'gemini', 'openai', 'openrouter'] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];

export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export type KeyStatus = Record<CloudProvider, { set: boolean; last4?: string }>;

export function isCloudProvider(p: unknown): p is CloudProvider {
  return typeof p === 'string' && (CLOUD_PROVIDERS as readonly string[]).includes(p);
}

export class KeyStore {
  private cache: Partial<Record<CloudProvider, string>> | null = null;
  constructor(
    private file: string,
    private cipher: Cipher
  ) {}

  private async load(): Promise<Partial<Record<CloudProvider, string>>> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.promises.readFile(this.file);
      this.cache = JSON.parse(this.cipher.decryptString(raw));
    } catch {
      this.cache = {}; // no file yet, or it can't be decrypted on this account (keys must be re-entered)
    }
    return this.cache!;
  }

  private async save(keys: Partial<Record<CloudProvider, string>>): Promise<void> {
    if (!this.cipher.isEncryptionAvailable()) throw new Error('This system has no secure storage for keys, so they cannot be saved.');
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.promises.writeFile(tmp, this.cipher.encryptString(JSON.stringify(keys)));
    await fs.promises.rename(tmp, this.file);
    this.cache = keys;
  }

  async get(provider: CloudProvider): Promise<string | undefined> {
    return (await this.load())[provider] || undefined;
  }

  async set(provider: CloudProvider, key: string): Promise<void> {
    const clean = key.trim();
    if (!clean || clean.length > 400 || /\s/.test(clean)) throw new Error('That does not look like an API key.');
    await this.save({ ...(await this.load()), [provider]: clean });
  }

  async clear(provider: CloudProvider): Promise<void> {
    const keys = { ...(await this.load()) };
    delete keys[provider];
    await this.save(keys);
  }

  async status(): Promise<KeyStatus> {
    const keys = await this.load();
    const out = {} as KeyStatus;
    for (const p of CLOUD_PROVIDERS) out[p] = keys[p] ? { set: true, last4: keys[p]!.slice(-4) } : { set: false };
    return out;
  }
}
