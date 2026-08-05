import { chromium } from 'playwright';
import type { Page } from 'playwright';
import Ajv from 'ajv';
import fs from 'fs/promises';
import path from 'path';
import type { FormSchemaMapping, SubmissionResult, GoogleAuthOptions } from './types';
import { GoogleAuthService } from './google-auth-service';
import { GoogleDriveService } from './google-drive-service';
import { parseFormDefinition } from './form-definition';

const ajv = new Ajv({ allErrors: true });

export class GoogleFormSubmitter {
  private formUrl: string;
  private jsonSchema: Record<string, any>;
  private mappingSchema: FormSchemaMapping;
  private cdpUrl: string;
  private cacheFilePath: string;
  private entryIdCache: Record<string, string> | null = null;
  private validateFn: ReturnType<typeof ajv.compile>;
  private cookies?: Array<any>;
  private authService: GoogleAuthService;
  private driveService: GoogleDriveService;

  constructor(options: {
    formUrl: string;
    jsonSchema: Record<string, any>;
    mappingSchema: FormSchemaMapping;
    cdpUrl?: string;
    cacheDir?: string;
    cookies?: Array<any>;
    auth?: GoogleAuthOptions;
  }) {
    this.formUrl = options.formUrl;
    this.jsonSchema = options.jsonSchema;
    this.mappingSchema = options.mappingSchema;
    this.cdpUrl = options.cdpUrl || 'ws://127.0.0.1:9222/';
    this.cookies = options.cookies;

    this.authService = new GoogleAuthService(options.auth);
    this.driveService = new GoogleDriveService(this.authService);

    // Compile JSON Schema validation function
    this.validateFn = ajv.compile(this.jsonSchema);

    // Compute a hash or safe name for the cache file based on the form URL
    const formIdMatch = this.formUrl.match(/\/d\/e\/([a-zA-Z0-9_-]+)/) || this.formUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const formHash = formIdMatch ? formIdMatch[1] : Buffer.from(this.formUrl).toString('base64').substring(0, 16);
    
    const cacheDir = options.cacheDir || process.cwd();
    this.cacheFilePath = path.join(cacheDir, `form-cache-${formHash}.json`);
  }

  /**
   * Lazily loads and returns the resolved entryId mapping cache.
   * If cache file exists, reads it. Otherwise, launches Lightpanda CDP,
   * reads the form definition, caches it, and closes the browser.
   */
  private async getOrResolveEntryIds(): Promise<Record<string, string>> {
    if (this.entryIdCache) {
      return this.entryIdCache;
    }

    // 1. Try reading from cache file
    try {
      const content = await fs.readFile(this.cacheFilePath, 'utf-8');
      this.entryIdCache = JSON.parse(content);
      console.log(`[GoogleFormSubmitter] Loaded entry ID mapping cache from: ${this.cacheFilePath}`);
      return this.entryIdCache!;
    } catch {
      // Cache file doesn't exist, proceed to resolve
      console.log(`[GoogleFormSubmitter] Cache not found. Resolving entry IDs dynamically via Lightpanda...`);
    }

    // 2. Launch browser to read the form definition
    let browser;
    let context;

    try {
      console.log(`[GoogleFormSubmitter] Connecting to CDP server at ${this.cdpUrl}...`);
      browser = await chromium.connectOverCDP(this.cdpUrl, { timeout: 5000 });
      context = await browser.newContext();
    } catch (e: any) {
      console.warn(`[GoogleFormSubmitter] CDP connection to Lightpanda failed: ${e.message}. Falling back to native headless Chromium...`);
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext();
    }
    if (this.cookies && this.cookies.length > 0) {
      await context.addCookies(this.cookies);
      console.log(`[GoogleFormSubmitter] Injected ${this.cookies.length} cookies into browser context.`);
    }
    const page = await context.newPage();

    try {
      await this.openForm(page);

      // Read the form's own definition rather than the rendered DOM: the DOM only ever holds the
      // section currently on screen, so on a multi-section form everything past section 1 is
      // invisible to a DOM scan — including forms whose first section is just an intro.
      const definition = parseFormDefinition(await page.content());

      const entryIdsByLabel: Record<string, string> = {};
      for (const question of definition.questions) {
        if (question.label) {
          entryIdsByLabel[question.label] = question.entryId;
        }
      }

      console.log(
        `[GoogleFormSubmitter] Discovered ${Object.keys(entryIdsByLabel).length} fields across ${definition.pageCount} section(s).`
      );

      // 3. Map properties from mappingSchema to Google Forms entryIds
      const resolvedCache: Record<string, string> = {};
      for (const [propName, fieldMapping] of Object.entries(this.mappingSchema)) {
        // Find matching entryId by label
        const matchedEntryId = entryIdsByLabel[fieldMapping.label];
        if (matchedEntryId) {
          resolvedCache[propName] = matchedEntryId;
        } else {
          console.warn(`[GoogleFormSubmitter] Warning: Could not resolve entryId for field "${propName}" (label: "${fieldMapping.label}")`);
        }
      }

      // Save to cache file
      await fs.mkdir(path.dirname(this.cacheFilePath), { recursive: true });
      await fs.writeFile(this.cacheFilePath, JSON.stringify(resolvedCache, null, 2));
      console.log(`[GoogleFormSubmitter] Saved resolved entry IDs cache to: ${this.cacheFilePath}`);

      this.entryIdCache = resolvedCache;
      return resolvedCache;
    } finally {
      await context.close();
      await browser.close();
    }
  }

  /**
   * Opens the form, throwing a clear error instead of timing out when it no longer accepts
   * responses.
   *
   * Waits for the `form` element rather than a question container: on a form whose first section
   * is an intro there are no question containers to wait for, and waiting for one burns the whole
   * timeout before failing for the wrong reason.
   */
  private async openForm(page: Page): Promise<void> {
    await page.goto(this.formUrl);

    await Promise.any([
      page.locator('form').first().waitFor({ state: 'attached', timeout: 15000 }),
      page.waitForURL(/\/closedform/, { timeout: 15000 })
    ]).catch(() => {});

    const isClosed =
      page.url().includes('/closedform') || (await page.locator('form').count()) === 0;

    if (isClosed) {
      throw new Error('Google Form is closed (no longer accepting responses)');
    }
  }

  /**
   * Validates input data and submits the form via direct HTTP POST.
   */
  public async submit(data: unknown): Promise<SubmissionResult> {
    // 1. Validate data against JSON Schema
    const isValid = this.validateFn(data);
    if (!isValid) {
      const errorMsg = this.validateFn.errors
        ?.map((err) => `${err.instancePath} ${err.message}`)
        .join(', ');
      throw new Error("Validation failed: " + errorMsg);
    }

    const typedData = data as Record<string, any>;

    // 2. Get entryId mapping cache (resolves lazily if needed)
    const entryIds = await this.getOrResolveEntryIds();

    const fieldsMap: Record<string, string[]> = {};
    const fieldsSubmitted: Record<string, string> = {};

    for (const [propName, value] of Object.entries(typedData)) {
      const entryId = entryIds[propName];
      if (!entryId) {
        continue;
      }

      const fieldMapping = this.mappingSchema[propName];
      if (!fieldMapping) {
        continue;
      }
      
      if (!fieldsMap[entryId]) {
        fieldsMap[entryId] = [];
      }

      const currentList = fieldsMap[entryId];

      if (fieldMapping.type === 'file') {
        if (value && typeof value === 'object' && ('fileId' in value || 'buffer' in value)) {
          let fileId = value.fileId;
          if (!fileId && value.buffer) {
            console.log(`[GoogleFormSubmitter] File buffer detected. Uploading "${value.filename}" to Google Drive...`);
            fileId = await this.driveService.uploadFile(value.filename, value.mimeType, value.buffer);
          }
          if (fileId) {
            const filePayload = [[[fileId, value.filename, value.mimeType]]];
            const serialized = JSON.stringify(filePayload);
            currentList?.push(serialized);
            fieldsSubmitted[fieldMapping.label] = serialized;
          }
        }
      } else if (fieldMapping.type === 'choice' && fieldMapping.allowOther && value) {
        const isPredefined = fieldMapping.options?.choices?.includes(value);
        if (isPredefined === false) {
          currentList?.push('__other_option__');
          
          const otherResponseKey = `${entryId}.other_option_response`;
          let otherResponseList = fieldsMap[otherResponseKey];
          if (!otherResponseList) {
            otherResponseList = [];
            fieldsMap[otherResponseKey] = otherResponseList;
          }
          otherResponseList.push(value);
          
          fieldsSubmitted[fieldMapping.label] = `__other_option__ (${value})`;
        } else {
          currentList?.push(value);
          fieldsSubmitted[fieldMapping.label] = value;
        }
      } else {
        currentList?.push(String(value));
        fieldsSubmitted[fieldMapping.label] = String(value);
      }
    }

    // 4. Send direct HTTP POST inside the browser context to preserve cookies and hidden fields
    let browser;
    let context;

    try {
      browser = await chromium.connectOverCDP(this.cdpUrl, { timeout: 5000 });
      context = await browser.newContext();
    } catch {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext();
    }

    if (this.cookies && this.cookies.length > 0) {
      await context.addCookies(this.cookies);
    }
    const page = await context.newPage();

    try {
      await this.openForm(page);

      console.log(`[GoogleFormSubmitter] Sending HTTP POST request in page context...`);
      const responseInfo = await page.evaluate(async ({ fieldsMap }) => {
        const g = globalThis as any;
        const form = g.document.querySelector('form');
        if (!form) throw new Error('Could not find form element on page');

        const searchParams = new URLSearchParams();
        const formData = new g.FormData(form);

        for (const [key, val] of formData.entries()) {
          if (!key.startsWith('entry.')) {
            searchParams.append(key, String(val));
          }
        }

        for (const [entryId, values] of Object.entries(fieldsMap)) {
          const list = values as string[];
          for (const val of list) {
            searchParams.append(`entry.${entryId}`, val);
          }
        }

        const actionUrl = form.getAttribute('action') || '';
        const resolvedActionUrl = new URL(actionUrl, g.location.href).href;

        console.log(`Sending POST to ${resolvedActionUrl}...`);
        const response = await g.fetch(resolvedActionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: searchParams.toString()
        });

        return {
          status: response.status,
          url: response.url,
          bodyText: await response.text()
        };
      }, { fieldsMap });

      const success = responseInfo.status === 200;

      return {
        success,
        statusCode: responseInfo.status,
        message: success ? 'Form submitted successfully' : `Server responded with status ${responseInfo.status}`,
        fieldsSubmitted
      };
    } finally {
      await context.close();
      await browser.close();
    }
  }

  /**
   * Helper to format submitted fields or raw payload into a clean, human-readable list.
   */
  public static formatFields(fields: Record<string, any>): string {
    const formatValue = (val: any): string => {
      if (typeof val === 'string') {
        if (val.startsWith('[[[') && val.endsWith(']]]')) {
          try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed) && parsed[0]?.[0]?.[1]) {
              return parsed[0][0][1];
            }
          } catch {}
        }
        return val;
      }
      if (val === null || val === undefined) {
        return '—';
      }
      return String(val);
    };

    return Object.entries(fields)
      .map(([key, val]) => `• ${key}: ${formatValue(val)}`)
      .join('\n');
  }
}

