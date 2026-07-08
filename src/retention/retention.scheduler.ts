import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class RetentionScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(RetentionScheduler.name);

  constructor(@InjectQueue('retention-queue') private readonly queue: Queue) {}

  async onApplicationBootstrap() {
    // Schedule the job to run every day at 2:00 AM
    await this.queue.add(
      'anonymize-rejected-cases',
      {},
      {
        repeat: { pattern: '0 2 * * *' },
        jobId: 'daily-anonymization-job', // Ensures we don't duplicate the cron schedule
      },
    );
    this.logger.log('Daily retention anonymization job scheduled.');
  }
}
