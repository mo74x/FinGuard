import * as crypto from 'crypto';

export class CryptoUtil {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 16;
  private static readonly AUTH_TAG_LENGTH = 16;

  //Encrypts a buffer using AES-256-GCM.
  //Returns a single buffer containing: [IV] + [AuthTag] + [EncryptedData]
  static encrypt(buffer: Buffer, keyHex: string): Buffer {
    const key = Buffer.from(keyHex, 'hex');
    const iv = crypto.randomBytes(this.IV_LENGTH);
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Pack the payload for easy storage: IV (16 bytes) + AuthTag (16 bytes) + Ciphertext
    return Buffer.concat([iv, authTag, encrypted]);
  }

  //Decrypts a previously packed buffer.
  //Throws an error if the AuthTag doesn't match (indicating tampering/corruption).
  static decrypt(packedBuffer: Buffer, keyHex: string): Buffer {
    const key = Buffer.from(keyHex, 'hex');
    const iv = packedBuffer.subarray(0, this.IV_LENGTH);
    const authTag = packedBuffer.subarray(
      this.IV_LENGTH,
      this.IV_LENGTH + this.AUTH_TAG_LENGTH,
    );
    const encrypted = packedBuffer.subarray(
      this.IV_LENGTH + this.AUTH_TAG_LENGTH,
    );

    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  //Generates an HMAC-SHA256 signature for Signed URLs.
  static signPayload(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  static generateMasterKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  static generateDerivedKey(masterKeyHex: string, saltHex: string): string {
    return crypto
      .pbkdf2Sync(masterKeyHex, saltHex, 100000, 32, 'sha256')
      .toString('hex');
  }
}
