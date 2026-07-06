import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';

export class GoogleAuthService {
  private credentialsDir: string;

  constructor(credentialsDir: string) {
    this.credentialsDir = credentialsDir;
  }

  /**
   * Resolves Google Auth OAuth2 Client using env variables or files.
   */
  public async getGoogleAuthClient(): Promise<any> {
    // 1. Direct Env variables check (Zero-file config for Production/CI)
    const envClientId = process.env.GOOGLE_CLIENT_ID;
    const envClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const envRefreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (envClientId && envClientSecret && envRefreshToken) {
      const oauth2Client = new google.auth.OAuth2(envClientId, envClientSecret);
      oauth2Client.setCredentials({ refresh_token: envRefreshToken });
      await oauth2Client.getAccessToken();
      return oauth2Client;
    }

    // 2. Custom file paths or fallback directories search
    let tokenPath = process.env.GOOGLE_OAUTH_TOKEN_PATH || '';
    let credentialsPath = process.env.GOOGLE_OAUTH_CREDENTIALS_PATH || '';

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
    const clientId = credentials.client_id || credentials.web?.client_id || credentials.installed?.client_id;
    const clientSecret = credentials.client_secret || credentials.web?.client_secret || credentials.installed?.client_secret;
    const refreshToken = credentials.refresh_token;

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    
    await oauth2Client.getAccessToken();
    return oauth2Client;
  }
}
