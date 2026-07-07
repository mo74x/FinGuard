/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import { Prisma, ActorRole, AuditLog } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateAuditLogDto {
  entityType: string;
  entityId: string;
  action: string;
  actorId?: string;
  actorRole: ActorRole;
  previousState?: Prisma.InputJsonValue;
  newState?: Prisma.InputJsonValue;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates a transaction-compliant write operation.
   * Accepts a Prisma Transaction Client instance to ensure it runs inside the parent transaction scope.
   */
  public createInTransaction(
    tx: Prisma.TransactionClient,
    dto: CreateAuditLogDto,
  ): Prisma.Prisma__AuditLogClient<AuditLog> {
    return tx.auditLog.create({
      data: {
        entityType: dto.entityType,
        entityId: dto.entityId,
        action: dto.action,
        actorId: dto.actorId ?? null,
        actorRole: dto.actorRole,
        previousState: dto.previousState ?? Prisma.JsonNull,
        newState: dto.newState ?? Prisma.JsonNull,
        ipAddress: dto.ipAddress ?? null,
      },
    });
  }

  /**
   * Fetch audit trails for Reviewers / Admins.
   */
  public async getLogByEntity(
    entityType: string,
    entityId: string,
  ): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
