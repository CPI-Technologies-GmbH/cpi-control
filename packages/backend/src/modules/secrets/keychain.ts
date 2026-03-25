import { createChildLogger } from '../../shared/logger.js';

const log = createChildLogger('keychain');
const SERVICE_NAME = 'com.opsboard.secrets';

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(): Promise<string[]>;
  isAvailable(): Promise<boolean>;
}

export class KeychainSecretStore implements SecretStore {
  private keytar: typeof import('keytar') | null = null;
  private keys = new Set<string>();

  async init(): Promise<boolean> {
    try {
      this.keytar = await import('keytar');
      // Try a test operation to verify keychain access
      await this.keytar.findCredentials(SERVICE_NAME);
      log.info('Keychain secret store initialized');
      return true;
    } catch (err: any) {
      log.warn({ error: err.message }, 'Keychain not available, falling back to encrypted store');
      this.keytar = null;
      return false;
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.keytar !== null;
  }

  async get(key: string): Promise<string | null> {
    if (!this.keytar) return null;
    try {
      return await this.keytar.getPassword(SERVICE_NAME, key);
    } catch (err: any) {
      log.error({ key, error: err.message }, 'Failed to get secret from keychain');
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.keytar) throw new Error('Keychain not available');
    try {
      await this.keytar.setPassword(SERVICE_NAME, key, value);
      this.keys.add(key);
    } catch (err: any) {
      log.error({ key, error: err.message }, 'Failed to set secret in keychain');
      throw err;
    }
  }

  async delete(key: string): Promise<boolean> {
    if (!this.keytar) return false;
    try {
      const result = await this.keytar.deletePassword(SERVICE_NAME, key);
      this.keys.delete(key);
      return result;
    } catch (err: any) {
      log.error({ key, error: err.message }, 'Failed to delete secret from keychain');
      return false;
    }
  }

  async list(): Promise<string[]> {
    if (!this.keytar) return [];
    try {
      const credentials = await this.keytar.findCredentials(SERVICE_NAME);
      return credentials.map((c) => c.account);
    } catch (err: any) {
      log.error({ error: err.message }, 'Failed to list secrets from keychain');
      return [];
    }
  }
}
