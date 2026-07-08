import * as bcrypt from 'bcrypt';

export class HashUtil {
  private static readonly SALT_ROUNDS = 10;

  static async hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, this.SALT_ROUNDS);
  }

  static async compare(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }
}
