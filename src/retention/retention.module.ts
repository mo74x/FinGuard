import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { RetentionProcessor } from './retention.processor';
import { RetentionScheduler } from './retention.scheduler';
import { EnvConfig } from '../config/env.validation';
import { AuditService } from '../audit/audit.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        connection: {
          host: config.get('REDIS_HOST'),
          port: config.get('REDIS_PORT'),
        },
      }),
    }),
    BullModule.registerQueue({
      name: 'retention-queue',
    }),
  ],
  providers: [RetentionProcessor, RetentionScheduler, AuditService],
})
export class RetentionModule {}
