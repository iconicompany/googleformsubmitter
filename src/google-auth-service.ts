import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';
import type { GoogleAuthOptions } from './types';

export class GoogleAuthService {
  private credentialsDir: string;
  private authOptions?: GoogleAuthOptions;

  constructor(credentialsDir: string, authOptions?: GoogleAuthOptions) {
    this.credentialsDir = credentialsDir;
    this.authOptions = authOptions;
  }

  /**
   * Resolves Google Auth OAuth2 Client using env variables or files.
   */
  public async getGoogleAuthClient(): Promise<any> {
    // 1. Direct Options / Env variables check (Zero-file config for Production/CI)
    const clientId = this.authOptions?.clientId || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = this.authOptions?.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = this.authOptions?.refreshToken || process.env.GOOGLE_REFRESH_TOKEN;

    if (clientId && clientSecret && refreshToken) {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      await oauth2Client.getAccessToken();
      return oauth2Client;
    }

    // 2. Custom file paths or fallback directories search
    let tokenPath = this.authOptions?.tokenPath || process.env.GOOGLE_OAUTH_TOKEN_PATH || '';
    let credentialsPath = this.authOptions?.credentialsPath || process.env.GOOGLE_OAUTH_CREDENTIALS_PATH || '';

    if (!tokenPath || !credentialsPath) {
      const searchDirs = [this.credentialsDir];
      if (this.credentialsDir === path.join(process.cwd(), '.data')) {
        searchDirs.push(path.join(process.cwd(), '..', '.data'));
      }

      for (const dir of searchDirs) {
        const t = tokenPath || path.join(dir, 'forms-auth.json');
        const c = credentialsPath || path.join(dir, 'credentials.json');
        
        let tExists = false;
        let cExists = false;
        try {
          await fs.access(t);
          tExists = true;
        } catch {}
        try {
          await fs.access(c);
          cExists = true;
        } catch {}

        if (tExists && cExists) {
          tokenPath = t;
          credentialsPath = c;
          break;
        }
      }
    }

    if (!tokenPath || !credentialsPath) {
      throw new Error(
        '[GoogleFormSubmitter] Google OAuth credentials not found. ' +
        'Provide them via env (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN) ' +
        'or via files (GOOGLE_OAUTH_CREDENTIALS_PATH, GOOGLE_OAUTH_TOKEN_PATH).'
      );
    }

    const content = await fs.readFile(tokenPath, 'utf-8');
    const credentials = JSON.parse(content);
    
    // We can support both standard authorized_user JSON format or direct refresh_token JSON
    const fileClientId = credentials.client_id || credentials.web?.client_id || credentials.installed?.client_id;
    const fileClientSecret = credentials.client_secret || credentials.web?.client_secret || credentials.installed?.client_secret;
    const fileRefreshToken = credentials.refresh_token;

    const oauth2Client = new google.auth.OAuth2(fileClientId, fileClientSecret);
    oauth2Client.setCredentials({ refresh_token: fileRefreshToken });
    
    await oauth2Client.getAccessToken();
    return oauth2Client;
  }
}
