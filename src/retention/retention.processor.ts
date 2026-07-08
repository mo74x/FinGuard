/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from '../config/env.validation';
import { CaseStatus, ActorRole } from '../../generated/prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';

@Processor('retention-queue')
export class RetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(RetentionProcessor.name);
  private readonly storagePath = path.join(process.cwd(), 'storage');

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<void> {
    this.logger.log(`Starting retention job: ${job.id}`);

    const retentionDays = this.config.get('REJECTED_CASE_RETENTION_DAYS');
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    // 1. Find all eligible cases
    const casesToAnonymize = await this.prisma.verificationCase.findMany({
      where: {
        status: CaseStatus.REJECTED,
        updatedAt: { lt: cutoffDate }, // Older than cutoff
      },
      include: { documents: true },
    });

    if (casesToAnonymize.length === 0) {
      this.logger.log('No cases require anonymization today.');
      return;
    }

    this.logger.log(`Found ${casesToAnonymize.length} cases to scrub.`);

    // 2. Process each case safely
    for (const verificationCase of casesToAnonymize) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // A. Anonymize the Applicant Record
          await tx.applicant.update({
            where: { id: verificationCase.applicantId },
            data: {
              fullName: 'ANONYMIZED_USER',
              email: `anonymized_${verificationCase.applicantId}@finguard.local`,
              passwordHash: 'SCRUBBED',
            },
          });

          // B. Write to the Audit Log as the SYSTEM
          await this.auditService.createInTransaction(tx, {
            entityType: 'VerificationCase',
            entityId: verificationCase.id,
            action: 'COMPLIANCE_ANONYMIZATION',
            actorRole: ActorRole.SYSTEM,
            previousState: { status: verificationCase.status },
            newState: { status: verificationCase.status, scrubbed: true },
          });

          // C. Delete the encrypted files from the disk
          for (const doc of verificationCase.documents) {
            const filePath = path.join(
              this.storagePath,
              doc.encryptedStoragePath,
            );
            try {
              await fs.unlink(filePath);

              // Nullify the DB path so we know the file is gone, but keep the record for audit metrics
              await tx.document.update({
                where: { id: doc.id },
                data: { encryptedStoragePath: 'DELETED_BY_RETENTION_POLICY' },
              });
            } catch (err) {
              if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw err; // If it's a real error (permission denied, etc), abort transaction
              }
            }
          }
        });

        this.logger.log(`Successfully anonymized case: ${verificationCase.id}`);
      } catch (error) {
        this.logger.error(
          `Failed to anonymize case ${verificationCase.id}`,
          error,
        );
        // We catch here so one failing case doesn't stop the whole queue from processing the rest
      }
    }
  }
}
