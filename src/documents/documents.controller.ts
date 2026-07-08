import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Body,
  Res,
  ParseEnumPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CaseOwnershipGuard } from '../common/guards/case-ownership.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { DocumentType } from '../../generated/prisma/client';

@Controller('verification-cases')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post(':id/documents')
  @UseGuards(JwtAuthGuard, RolesGuard, CaseOwnershipGuard)
  @Roles('APPLICANT')
  @UseInterceptors(FileInterceptor('file')) // memory storage
  async uploadDocument(
    @Param('id') caseId: string,
    @Body('type', new ParseEnumPipe(DocumentType)) type: DocumentType,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const document = await this.documentsService.uploadDocument(
      caseId,
      type,
      file,
    );
    return { data: document, error: null };
  }

  @Get(':id/documents/:documentId/signed-url')
  @UseGuards(JwtAuthGuard, CaseOwnershipGuard)
  async getSignedUrl(@Param('documentId') documentId: string) {
    const signedUrl = await this.documentsService.generateSignedUrl(documentId);
    return { data: { url: signedUrl }, error: null };
  }

  // The actual endpoint the Signed URL points to.
  @Get('documents/view')
  async viewDocument(
    @Query('id') id: string,
    @Query('expires') expires: number,
    @Query('sig') signature: string,
    @Res() res: Response,
  ) {
    const decryptedBuffer = await this.documentsService.retrieveAndDecrypt(
      id,
      expires,
      signature,
    );

    // Set headers to serve inline (so browsers display the image/PDF)
    res.setHeader('Content-Type', 'application/octet-stream'); // Fallback, could infer from mime-type
    res.setHeader(
      'Content-Disposition',
      'inline; filename="decrypted_document"',
    );
    res.send(decryptedBuffer);
  }
}
