import fs from 'fs/promises';
import path from 'path';
import { google } from 'googleapis';

export class GoogleAuthService {
  private credentialsDir: string;

  constructor(credentialsDir: string) {
    this.credentialsDir = credentialsDir;
  }

  /**
   * Resolves Google Auth OAuth2 Client using credentials.json and forms-auth.json.
   */
  public async getGoogleAuthClient(): Promise<any> {
    const searchDirs = [this.credentialsDir];
    if (this.credentialsDir === path.join(process.cwd(), '.data')) {
      searchDirs.push(path.join(process.cwd(), '..', '.data'));
    }

    let tokenPath = '';
    let credentialsPath = '';

    for (const dir of searchDirs) {
      const t = path.join(dir, 'forms-auth.json');
      const c = path.join(dir, 'credentials.json');
      try {
        await fs.access(t);
        tokenPath = t;
      } catch {}
      try {
        await fs.access(c);
        credentialsPath = c;
      } catch {}
      if (tokenPath && credentialsPath) break;
    }

    if (!tokenPath || !credentialsPath) {
      throw new Error(`[GoogleFormSubmitter] Google Forms/Drive OAuth credentials (forms-auth.json, credentials.json) not found in directories: ${searchDirs.join(', ')}`);
    }

    const content = await fs.readFile(tokenPath, 'utf-8');
    const credentials = JSON.parse(content);
    
    const oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret
    );
    oauth2Client.setCredentials({ refresh_token: credentials.refresh_token });
    
    // Refresh access token if needed
    await oauth2Client.getAccessToken();
    return oauth2Client;
  }
}
