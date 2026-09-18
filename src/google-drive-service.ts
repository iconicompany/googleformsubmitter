import { drive as driveApi } from '@googleapis/drive';
import { Readable } from 'stream';
import type { GoogleAuthService } from './google-auth-service';

export class GoogleDriveService {
  private authService: GoogleAuthService;

  constructor(authService: GoogleAuthService) {
    this.authService = authService;
  }

  /**
   * Uploads a file buffer directly to Google Drive.
   */
  public async uploadFile(filename: string, mimeType: string, buffer: Buffer): Promise<string> {
    const auth = await this.authService.getGoogleAuthClient();
    const drive = driveApi({ version: 'v3', auth });
    
    const response = await drive.files.create({
      requestBody: {
        name: filename
      },
      media: {
        mimeType,
        body: Readable.from(buffer)
      },
      fields: 'id'
    });

    const id = response.data.id;
    if (!id) {
      throw new Error('[GoogleFormSubmitter] Failed to upload file to Google Drive: response did not contain file ID');
    }
    return id;
  }
}
