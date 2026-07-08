/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { HashUtil } from './utils/hash.util';
import { Role } from '../../generated/prisma/client';
import Redis from 'ioredis';
//import { randomBytes } from 'crypto';
import { EnvConfig } from '../config/env.validation';
import { RegisterApplicantDto, LoginDto } from './dto/auth.dto';

export interface TokenPayload {
  sub: string; // User ID
  email: string;
  role: 'APPLICANT' | Role;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvConfig, true>,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  /**
   * Registers a new Applicant.
   */
  async registerApplicant(dto: RegisterApplicantDto) {
    const existing = await this.prisma.applicant.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new UnauthorizedException('Email already in use.');
    }

    const passwordHash = await HashUtil.hash(dto.password);
    const applicant = await this.prisma.applicant.create({
      data: {
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        dateOfBirth: new Date(dto.dateOfBirth),
      },
    });

    return this.generateTokens({
      sub: applicant.id,
      email: applicant.email,
      role: 'APPLICANT',
    });
  }

  /**
   * Universal Login (Handles both Applicants and Reviewers based on requested role)
   */
  async login(dto: LoginDto, identitySpace: 'APPLICANT' | 'REVIEWER') {
    let user;
    if (identitySpace === 'APPLICANT') {
      user = await this.prisma.applicant.findUnique({
        where: { email: dto.email },
      });
    } else {
      user = await this.prisma.reviewer.findUnique({
        where: { email: dto.email },
      });
    }

    if (!user || !(await HashUtil.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const role =
      identitySpace === 'APPLICANT' ? 'APPLICANT' : (user as any).role;
    return this.generateTokens({ sub: user.id, email: user.email, role });
  }

  /**
   * Refreshes the access token and rotates the refresh token.
   */
  async refreshTokens(userId: string, incomingRefreshToken: string) {
    const redisKey = `refresh_token:${userId}`;
    const storedTokenHash = await this.redis.get(redisKey);

    if (
      !storedTokenHash ||
      !(await HashUtil.compare(incomingRefreshToken, storedTokenHash))
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Identify user to rebuild payload
    const applicant = await this.prisma.applicant.findUnique({
      where: { id: userId },
    });
    const reviewer = await this.prisma.reviewer.findUnique({
      where: { id: userId },
    });
    const user = applicant || reviewer;

    if (!user) throw new UnauthorizedException('User not found');
    const role = applicant ? 'APPLICANT' : (user as any).role;

    return this.generateTokens({ sub: user.id, email: user.email, role });
  }

  /**
   * Logs out the user by deleting their refresh token from Redis.
   */
  async logout(userId: string) {
    await this.redis.del(`refresh_token:${userId}`);
  }

  /**
   * Core Token Generator
   */
  private async generateTokens(payload: TokenPayload) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_ACCESS_SECRET'),
        expiresIn: '15m', // Short-lived access
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        expiresIn: '7d', // Long-lived refresh
      }),
    ]);

    // Hash the refresh token before storing it in Redis (Defense in Depth)
    const rtHash = await HashUtil.hash(refreshToken);
    const ttlSeconds = 60 * 60 * 24 * 7; // 7 days

    await this.redis.set(
      `refresh_token:${payload.sub}`,
      rtHash,
      'EX',
      ttlSeconds,
    );

    return { accessToken, refreshToken };
  }
}
