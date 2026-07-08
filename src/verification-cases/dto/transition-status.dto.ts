import { IsEnum, IsString, IsOptional } from 'class-validator';
import { CaseStatus, ActorRole } from '../../../generated/prisma/client';

export class TransitionStatusDto {
  @IsEnum(CaseStatus)
  targetStatus: CaseStatus;

  @IsString()
  actorId: string;

  @IsEnum(ActorRole)
  actorRole: ActorRole;

  @IsString()
  @IsOptional()
  rejectionReason?: string;
}
