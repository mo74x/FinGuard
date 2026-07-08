import {
  Controller,
  Param,
  Body,
  Patch,
  UseInterceptors,
  Ip,
} from '@nestjs/common';
import { VerificationCasesService } from './verification-cases.service';
import { TransitionStatusDto } from './dto/transition-status.dto';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';

@Controller('verification-cases')
export class VerificationCasesController {
  constructor(private readonly casesService: VerificationCasesService) {}

  /**
   * PATCH /verification-cases/:id/status
   *
   * Triggers a state-machine transition on the given verification case.
   * Supports idempotent retries via the Idempotency-Key header.
   */
  @Patch(':id/status')
  @UseInterceptors(IdempotencyInterceptor)
  async transitionStatus(
    @Param('id') id: string,
    @Body() dto: TransitionStatusDto,
    @Ip() ipAddress: string,
  ) {
    return this.casesService.transitionStatus({
      caseId: id,
      targetStatus: dto.targetStatus,
      actorId: dto.actorId,
      actorRole: dto.actorRole,
      rejectionReason: dto.rejectionReason,
      ipAddress,
    });
  }
}
