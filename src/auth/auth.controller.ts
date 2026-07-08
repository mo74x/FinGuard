/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  RegisterApplicantDto,
  LoginDto,
  RefreshTokenDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { Request } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('applicant/register')
  async registerApplicant(@Body() dto: RegisterApplicantDto) {
    const tokens = await this.authService.registerApplicant(dto);
    return { data: tokens, error: null };
  }

  @Post('applicant/login')
  @HttpCode(HttpStatus.OK)
  async loginApplicant(@Body() dto: LoginDto) {
    const tokens = await this.authService.login(dto, 'APPLICANT');
    return { data: tokens, error: null };
  }

  @Post('reviewer/login')
  @HttpCode(HttpStatus.OK)
  async loginReviewer(@Body() dto: LoginDto) {
    const tokens = await this.authService.login(dto, 'REVIEWER');
    return { data: tokens, error: null };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    // We decode the JWT without verifying expiration just to get the user ID for the Redis lookup
    // The refresh token itself acts as the secure credential here
    const jwtService = this.authService['jwtService'];
    const decoded = jwtService.decode(dto.refreshToken);

    if (!decoded || !decoded.sub) {
      return {
        data: null,
        error: { code: 'INVALID_TOKEN', message: 'Malformed token' },
      };
    }

    const tokens = await this.authService.refreshTokens(
      decoded.sub,
      dto.refreshToken,
    );
    return { data: tokens, error: null };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: any) {
    await this.authService.logout(user.id);
    return { data: { success: true }, error: null };
  }
}
