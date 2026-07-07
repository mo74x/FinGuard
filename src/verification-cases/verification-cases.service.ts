/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CaseStatus,
  ActorRole,
  VerificationCase,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationStateMachineService } from './verification-state-machine.service';
import { AuditService } from '../audit/audit.service';

export interface TransitionCaseDto {
  caseId: string;
  targetStatus: CaseStatus;
  actorId: string;
  actorRole: ActorRole;
  rejectionReason?: string;
  ipAddress?: string;
}

@Injectable()
export class VerificationCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: VerificationStateMachineService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Executes a robust, auditable state machine transition inside a database transaction.
   */
  public async transitionStatus(
    dto: TransitionCaseDto,
  ): Promise<VerificationCase> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Retrieve current record using a row lock (Pessimistic Write Lock) to prevent race conditions
      const currentCase = await tx.$queryRaw<VerificationCase[]>`
        SELECT * FROM "VerificationCase" 
        WHERE id = ${dto.caseId}::uuid 
        FOR UPDATE
      `.then((res) => res[0]);

      if (!currentCase) {
        throw new NotFoundException(
          `Verification case with ID ${dto.caseId} not found.`,
        );
      }

      // 2. Evaluate transition legality via our pure domain service
      // This will throw InvalidStateTransitionException if illegal
      this.stateMachine.transition(currentCase.status, dto.targetStatus);

      // Idempotency short-circuit: If current matches target, bypass writes and return safely
      if (currentCase.status === dto.targetStatus) {
        return currentCase;
      }

      // 3. Formulate structural data payloads for the Audit Log
      const previousStateJson = {
        status: currentCase.status,
        rejectionReason: currentCase.rejectionReason,
      };
      const newStateJson = {
        status: dto.targetStatus,
        rejectionReason: dto.rejectionReason ?? null,
      };

      // 4. Update the case record status
      const updatedCase = await tx.verificationCase.update({
        where: { id: dto.caseId },
        data: {
          status: dto.targetStatus,
          rejectionReason: dto.rejectionReason ?? null,
        },
      });

      // 5. Append immutable operational record to the Audit Log table within the same transaction scope
      await this.auditService.createInTransaction(tx, {
        entityType: 'VerificationCase',
        entityId: dto.caseId,
        action: 'STATUS_CHANGED',
        actorId: dto.actorId,
        actorRole: dto.actorRole,
        previousState: previousStateJson,
        newState: newStateJson,
        ipAddress: dto.ipAddress,
      });

      // 6. Side effects (e.g. queueing email via BullMQ) should be triggered here *after* or *via* outbox pattern
      // To keep it clean, we emit events or resolve, ensuring no external HTTP calls are inside this database transaction block.

      return updatedCase;
    });
  }
}
