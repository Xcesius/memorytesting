import crypto from 'crypto';
import { promisify } from 'util';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128-bit authentication tag
const KEY_LENGTH = 32; // 256-bit key
const SALT_LENGTH = 16; // 128-bit salt

const pbkdf2Async = promisify(crypto.pbkdf2);

export class EncryptionManager {
  constructor(masterKey) {
    if (!masterKey || masterKey.length < 32) {
      throw new Error('Master key must be at least 32 characters');
    }
    this.masterKey = masterKey;
  }

  async deriveKey(salt) {
    return pbkdf2Async(
      this.masterKey,
      salt,
      100000, // Iterations
      KEY_LENGTH,
      'sha512'
    );
  }

  async encrypt(data) {
    if (typeof data !== 'string') {
      data = JSON.stringify(data);
    }
    
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = await this.deriveKey(salt);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_LENGTH
    });
    
    const encrypted = Buffer.concat([
      cipher.update(data, 'utf8'),
      cipher.final()
    ]);
    
    const tag = cipher.getAuthTag();
    
    return Buffer.concat([
      salt,
      iv,
      tag,
      encrypted
    ]).toString('base64');
  }

  async decrypt(encryptedData) {
    const buffer = Buffer.from(encryptedData, 'base64');
    
    const salt = buffer.subarray(0, SALT_LENGTH);
    const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const tag = buffer.subarray(
      SALT_LENGTH + IV_LENGTH, 
      SALT_LENGTH + IV_LENGTH + TAG_LENGTH
    );
    const encrypted = buffer.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
    
    const key = await this.deriveKey(salt);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_LENGTH
    });
    
    decipher.setAuthTag(tag);
    
    try {
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
      ]);
      
      return JSON.parse(decrypted.toString('utf8'));
    } catch (error) {
      throw new Error('Decryption failed: Invalid key or corrupted data');
    }
  }

  static generateMasterKey() {
    return crypto.randomBytes(KEY_LENGTH).toString('base64');
  }
}