/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EnvConfig } from '../config/env.validation';
import { CryptoUtil } from './utils/crypto.util';
import { DocumentType } from '../../generated/prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class DocumentsService {
  private readonly storagePath = path.join(process.cwd(), 'storage');
  private readonly encryptionKey: string;
  private readonly jwtSecret: string; // Reusing for HMAC signatures

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {
    this.encryptionKey = this.configService.get('DOCUMENT_ENCRYPTION_KEY');
    this.jwtSecret = this.configService.get('JWT_ACCESS_SECRET');

    // Ensure local storage directory exists
    fs.mkdir(this.storagePath, { recursive: true }).catch(console.error);
  }

  // Encrypts and persists a document upload.
  async uploadDocument(
    caseId: string,
    type: DocumentType,
    file: Express.Multer.File,
  ) {
    // 1. Encrypt the file buffer in memory
    const encryptedBuffer = CryptoUtil.encrypt(file.buffer, this.encryptionKey);

    // 2. Generate a secure storage path (mocking an S3 key)
    const storageKey = `case_${caseId}_${Date.now()}.enc`;
    const fullPath = path.join(this.storagePath, storageKey);

    // 3. Write encrypted blob to disk
    await fs.writeFile(fullPath, encryptedBuffer);

    // 4. Save metadata to Database
    return this.prisma.document.create({
      data: {
        caseId,
        type,
        encryptedStoragePath: storageKey,
      },
    });
  }

  /**
   * Generates a short-lived (5 minute) signed URL for document retrieval.
   */
  async generateSignedUrl(documentId: string): Promise<string> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!document) throw new NotFoundException('Document not found');

    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes from now
    const payload = `${documentId}:${expiresAt}`;
    const signature = CryptoUtil.signPayload(payload, this.jwtSecret);

    // Return the relative URL path to our retrieval endpoint
    return `/verification-cases/documents/view?id=${documentId}&expires=${expiresAt}&sig=${signature}`;
  }

  // Validates a signature, retrieves, decrypts, and returns the file buffer.
  async retrieveAndDecrypt(
    documentId: string,
    expires: number,
    signature: string,
  ): Promise<Buffer> {
    // 1. Validate Expiration
    if (Date.now() > expires) {
      throw new UnauthorizedException('Signed URL has expired.');
    }

    // 2. Validate Signature (prevents tampering with the ID or Expiry)
    const expectedSignature = CryptoUtil.signPayload(
      `${documentId}:${expires}`,
      this.jwtSecret,
    );
    if (signature !== expectedSignature) {
      throw new UnauthorizedException('Invalid URL signature.');
    }

    // 3. Fetch Metadata
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });
    if (!document) throw new NotFoundException('Document not found');

    // 4. Read & Decrypt
    const fullPath = path.join(this.storagePath, document.encryptedStoragePath);
    try {
      const encryptedBuffer = await fs.readFile(fullPath);
      return CryptoUtil.decrypt(encryptedBuffer, this.encryptionKey);
    } catch (err) {
      throw new NotFoundException('Encrypted file blob not found on disk.');
    }
  }
}
