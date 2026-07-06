import fs from 'fs/promises';
import { google } from 'googleapis';
import type { GoogleAuthOptions } from './types';

export class GoogleAuthService {
  private authOptions?: GoogleAuthOptions;

  constructor(authOptions?: GoogleAuthOptions) {
    this.authOptions = authOptions;
  }

  /**
   * Resolves Google Auth OAuth2 Client using explicitly provided credentials or paths.
   */
  public async getGoogleAuthClient(): Promise<any> {
    // 1. Try explicit programmatic credentials
    const clientId = this.authOptions?.clientId;
    const clientSecret = this.authOptions?.clientSecret;
    const refreshToken = this.authOptions?.refreshToken;

    if (clientId && clientSecret && refreshToken) {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      await oauth2Client.getAccessToken();
      return oauth2Client;
    }

    // 2. Try explicit file paths
    const credentialsPath = this.authOptions?.credentialsPath;
    const tokenPath = this.authOptions?.tokenPath;

    if (!credentialsPath || !tokenPath) {
      throw new Error(
        '[GoogleFormSubmitter] Google OAuth credentials are not configured. ' +
        'Please pass { clientId, clientSecret, refreshToken } programmatically, ' +
        'or specify both { credentialsPath, tokenPath } in auth options.'
      );
    }

    // Load credentials from credentials.json
    const credentialsContent = await fs.readFile(credentialsPath, 'utf-8');
    const credentials = JSON.parse(credentialsContent);
    const fileClientId = credentials.client_id || credentials.web?.client_id || credentials.installed?.client_id;
    const fileClientSecret = credentials.client_secret || credentials.web?.client_secret || credentials.installed?.client_secret;

    // Load token from forms-auth.json
    const tokenContent = await fs.readFile(tokenPath, 'utf-8');
    const token = JSON.parse(tokenContent);
    const fileRefreshToken = token.refresh_token;

    if (!fileClientId || !fileClientSecret || !fileRefreshToken) {
      throw new Error(
        '[GoogleFormSubmitter] Invalid OAuth configuration in provided credential files: ' +
        'client_id, client_secret, or refresh_token is missing.'
      );
    }

    const oauth2Client = new google.auth.OAuth2(fileClientId, fileClientSecret);
    oauth2Client.setCredentials({ refresh_token: fileRefreshToken });
    
    await oauth2Client.getAccessToken();
    return oauth2Client;
  }
}
