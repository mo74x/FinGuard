/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-misused-promises */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
  HttpException,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';
import Redis from 'ioredis';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  // We keep idempotency keys for 24 hours.
  private readonly TTL_SECONDS = 60 * 60 * 24;

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<Request>();

    // 1. Extract the header (case-insensitive in Express)
    const idempotencyKey = req.headers['idempotency-key'] as string;

    // If the client didn't provide a key, just process the request normally
    if (!idempotencyKey) {
      return next.handle();
    }

    // Bind the key to the specific user and path to prevent key collisions across different users/endpoints
    const userId = req.user ? (req.user as any).id : 'anonymous';
    const cacheKey = `idempotency:${userId}:${req.path}:${idempotencyKey}`;

    // 2. Check Redis for a previously cached response
    const cachedResponse = await this.redis.get(cacheKey);
    if (cachedResponse) {
      try {
        const parsedResponse = JSON.parse(cachedResponse);
        // We use 'of' from RxJS to immediately return the cached data, bypassing the controller
        return of(parsedResponse);
      } catch (err) {
        // If JSON parsing fails, log it and proceed normally, falling back to execution
        console.error('Failed to parse cached idempotency response', err);
      }
    }

    // 3. Mark the key as 'in-flight' to prevent race conditions from simultaneous retries
    const setNXResult = await this.redis.setnx(cacheKey, 'IN_FLIGHT');
    await this.redis.expire(cacheKey, this.TTL_SECONDS);

    if (setNXResult === 0) {
      // 0 means the key already existed and is likely 'IN_FLIGHT' from a concurrent request
      throw new HttpException(
        {
          data: null,
          error: {
            code: 'CONCURRENT_REQUEST',
            message:
              'A request with this Idempotency-Key is currently being processed.',
          },
        },
        409,
      );
    }

    // 4. Proceed to the controller and capture the successful response
    return next.handle().pipe(
      tap(async (responseBody) => {
        // Cache the successful response so future retries get exactly this payload
        await this.redis.set(
          cacheKey,
          JSON.stringify(responseBody),
          'EX',
          this.TTL_SECONDS,
        );
      }),
    );
  }
}
