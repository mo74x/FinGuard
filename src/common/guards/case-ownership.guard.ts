/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from 'generated/prisma/enums';

@Injectable()
export class CaseOwnershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // We expect the case ID to be in the URL params, e.g., /verification-cases/:id
    const caseId = request.params.id || request.params.caseId;

    if (!caseId) return true; // If there's no case ID in the route, bypass this guard

    // Admins and Reviewers have global read access to cases, so they bypass ownership checks
    if (user.role === Role.ADMIN || user.role === Role.REVIEWER) {
      return true;
    }

    // Look up the case to check who owns it
    const verificationCase = await this.prisma.verificationCase.findUnique({
      where: { id: caseId },
      select: { applicantId: true },
    });

    if (!verificationCase) {
      throw new NotFoundException('Verification case not found.');
    }

    // Ensure the logged-in applicant owns this specific case
    if (verificationCase.applicantId !== user.id) {
      throw new ForbiddenException(
        'You do not have permission to access this resource.',
      );
    }

    return true;
  }
}
