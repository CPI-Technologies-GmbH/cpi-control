import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { SecretStore } from './keychain.js';
import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('fallback-encrypted-store');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

interface EncryptedVault {
  version: number;
  secrets: Record<string, { iv: string; data: string; tag: string }>;
}

export class FallbackEncryptedStore implements SecretStore {
  private filePath: string;
  private encryptionKey: Buffer;
  private vault: EncryptedVault;

  constructor(filePath?: string, passphrase?: string) {
    this.filePath = filePath || join(process.cwd(), '.opsboard', 'vault.enc');
    const phrase = passphrase || process.env.OPSBOARD_VAULT_PASSPHRASE || 'opsboard-dev-default-key';
    this.encryptionKey = createHash('sha256').update(phrase).digest();
    this.vault = this.loadVault();
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  private loadVault(): EncryptedVault {
    try {
      if (existsSync(this.filePath)) {
        const data = readFileSync(this.filePath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (err: any) {
      log.warn({ error: err.message }, 'Could not load vault, creating new one');
    }
    return { version: 1, secrets: {} };
  }

  private saveVault(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.filePath, JSON.stringify(this.vault, null, 2), 'utf-8');
    } catch (err: any) {
      log.error({ error: err.message }, 'Failed to save vault');
      throw err;
    }
  }

  private encrypt(plaintext: string): { iv: string; data: string; tag: string } {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return {
      iv: iv.toString('hex'),
      data: encrypted,
      tag: tag.toString('hex'),
    };
  }

  private decrypt(entry: { iv: string; data: string; tag: string }): string {
    const iv = Buffer.from(entry.iv, 'hex');
    const tag = Buffer.from(entry.tag, 'hex');
    const decipher = createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(entry.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.vault.secrets[key];
    if (!entry) return null;
    try {
      return this.decrypt(entry);
    } catch (err: any) {
      log.error({ key, error: err.message }, 'Failed to decrypt secret');
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    this.vault.secrets[key] = this.encrypt(value);
    this.saveVault();
  }

  async delete(key: string): Promise<boolean> {
    if (!(key in this.vault.secrets)) return false;
    delete this.vault.secrets[key];
    this.saveVault();
    return true;
  }

  async list(): Promise<string[]> {
    return Object.keys(this.vault.secrets);
  }
}
