import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { VerificationCasesService } from './verification-cases.service';
import { VerificationStateMachineService } from './verification-state-machine.service';
import { VerificationCasesController } from './verification-cases.controller';

@Module({
  imports: [AuditModule],
  controllers: [VerificationCasesController],
  providers: [VerificationCasesService, VerificationStateMachineService],
  exports: [VerificationCasesService],
})
export class VerificationCasesModule {}
