/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { VerificationCasesService } from './verification-cases.service';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationStateMachineService } from './verification-state-machine.service';
import { AuditService } from '../audit/audit.service';
import { CaseStatus, ActorRole } from '../../generated/prisma/client';
//import { InvalidStateTransitionException } from './exceptions/invalid-state-transition.exception';

describe('VerificationCasesService - Concurrency & Transactions', () => {
  let service: VerificationCasesService;
  let prisma: PrismaService;
  let testCaseId: string;
  let testApplicantId: string;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationCasesService,
        PrismaService,
        VerificationStateMachineService,
        AuditService,
      ],
    }).compile();

    service = module.get<VerificationCasesService>(VerificationCasesService);
    prisma = module.get<PrismaService>(PrismaService);

    // Seeding foundational applicant data
    const applicant = await prisma.applicant.create({
      data: {
        email: `concurrent.test.${Date.now()}@finguard.io`,
        fullName: 'Jane Doe',
        passwordHash: '$2b$10$hashedstring',
        dateOfBirth: new Date('1995-01-01'),
      },
    });
    testApplicantId = applicant.id;
  });

  beforeEach(async () => {
    // Fresh DRAFT case for every individual test routine
    const newCase = await prisma.verificationCase.create({
      data: {
        applicantId: testApplicantId,
        status: CaseStatus.DRAFT,
      },
    });
    testCaseId = newCase.id;
  });

  afterAll(async () => {
    // Clean data footprints
    await prisma.auditLog.deleteMany({ where: { entityId: testCaseId } });
    await prisma.verificationCase.deleteMany({ where: { id: testCaseId } });
    await prisma.applicant.deleteMany({ where: { id: testApplicantId } });
    await prisma.$disconnect();
  });

  it('should successfully execute a valid transition and write audit trail records atomically', async () => {
    const result = await service.transitionStatus({
      caseId: testCaseId,
      targetStatus: CaseStatus.SUBMITTED,
      actorId: testApplicantId,
      actorRole: ActorRole.APPLICANT,
    });

    expect(result.status).toBe(CaseStatus.SUBMITTED);

    const logs = await prisma.auditLog.findMany({
      where: { entityId: testCaseId },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('STATUS_CHANGED');
    expect((logs[0].newState as any).status).toBe(CaseStatus.SUBMITTED);
  });

  it('should guarantee absolute concurrency safety when racing dual execution calls', async () => {
    // Setup simultaneous requests trying to push DRAFT -> SUBMITTED at the exact same millisecond
    const executionBlock = [
      service.transitionStatus({
        caseId: testCaseId,
        targetStatus: CaseStatus.SUBMITTED,
        actorId: testApplicantId,
        actorRole: ActorRole.APPLICANT,
      }),
      service.transitionStatus({
        caseId: testCaseId,
        targetStatus: CaseStatus.SUBMITTED,
        actorId: testApplicantId,
        actorRole: ActorRole.APPLICANT,
      }),
    ];

    // Fire concurrently
    const outcomes = await Promise.allSettled(executionBlock);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    // Due to the self-transition Short-Circuit Idempotency Rule:
    // Case 1 secures the write lock, transitions DRAFT -> SUBMITTED, and unlocks.
    // Case 2 obtains the write lock, detects status is ALREADY SUBMITTED, short-circuits smoothly without erroring.
    expect(fulfilled.length).toBe(2);
    expect(rejected.length).toBe(0);

    // Double check that only 1 audit entry was ever written (since the second short-circuited)
    const logs = await prisma.auditLog.findMany({
      where: { entityId: testCaseId },
    });
    expect(logs).toHaveLength(1);
  });
});
