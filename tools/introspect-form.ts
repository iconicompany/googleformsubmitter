import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

function toCamelCase(str: string): string {
  // Map common Russian terms to standard project English keys
  const translations: Record<string, string> = {
    'фио': 'fullName',
    'дата рождения': 'birthDate',
    'грейд': 'grade',
    'локация': 'location',
    'рейт': 'rate',
    'ндс': 'nds',
    'когда кандидат': 'exitDate',
    'отпуск': 'vacation',
    'штате': 'inStaff',
    'cv': 'cvFile',
    'резюме': 'cvFile',
    'компания': 'company',
    'контакты': 'contacts',
    'требованиям': 'checklist',
    'комментарий': 'comment',
    'номер запроса': 'requestId'
  };

  const lower = str.toLowerCase();
  for (const [key, val] of Object.entries(translations)) {
    if (lower.includes(key)) {
      return val;
    }
  }

  // Fallback to transliteration + camelCase
  const clean = str
    .replace(/[^a-zA-Zа-яА-Я0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');

  const ru: Record<string, string> = {
    'а':'a', 'б':'b', 'в':'v', 'г':'g', 'д':'d', 'е':'e', 'ё':'yo', 'ж':'zh', 'з':'z', 'и':'i', 'й':'y', 'к':'k', 'л':'l', 'м':'m', 'н':'n', 'о':'o', 'п':'p', 'р':'r', 'с':'s', 'т':'t', 'у':'u', 'ф':'f', 'х':'h', 'ц':'ts', 'ч':'ch', 'ш':'sh', 'щ':'sch', 'ъ':'', 'ы':'y', 'ь':'', 'э':'e', 'ю':'yu', 'я':'ya',
    'А':'A', 'Б':'B', 'В':'V', 'Г':'G', 'Д':'D', 'Е':'E', 'Ё':'Yo', 'Ж':'Zh', 'З':'Z', 'И':'I', 'Й':'Y', 'К':'K', 'Л':'L', 'М':'M', 'Н':'N', 'О':'O', 'П':'P', 'Р':'R', 'С':'S', 'Т':'T', 'У':'U', 'Ф':'F', 'Х':'H', 'Ц':'Ts', 'Ч':'Ch', 'Ш':'Sh', 'Щ':'Sch', 'Ъ':'', 'Ы':'Y', 'Ь':'', 'Э':'E', 'Ю':'Yu', 'Я':'Ya'
  };
  
  let transliterated = '';
  for (const char of clean) {
    const replacement = ru[char] !== undefined ? ru[char] : char;
    transliterated += replacement;
  }

  const words = transliterated.split(' ');
  return words
    .map((word, idx) => {
      if (idx === 0) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join('');
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: bun run ./tools/introspect-form.ts <google-form-url>');
    process.exit(1);
  }

  console.log(`🔍 Connecting to Google Form at: ${url}...`);

  let browser;
  try {
    // Attempt connecting to local Lightpanda first
    browser = await chromium.connectOverCDP(process.env.LIGHTPANDA_CDP_URL || 'ws://127.0.0.1:9222/', { timeout: 5000 });
  } catch {
    console.log('Lightpanda not found, falling back to local headless Chromium...');
    browser = await chromium.launch({ headless: true });
  }

  const context = await browser.newContext();

  // Load session cookies if GOOGLE_COOKIES_PATH is configured
  const cookiesPath = process.env.GOOGLE_COOKIES_PATH;
  if (cookiesPath) {
    try {
      const cookiesStr = await fs.readFile(cookiesPath, 'utf8');
      const cookies = JSON.parse(cookiesStr);
      await context.addCookies(cookies);
      console.log(`[Introspect] Injected ${cookies.length} session cookies from ${cookiesPath}`);
    } catch (e: any) {
      console.warn(`[Introspect] Warning: Could not inject cookies: ${e.message}`);
    }
  }

  const page = await context.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  try {
    await page.goto(url);

    // Wait for the form contents to load
    await Promise.any([
      page.locator('.Qr7Oae').first().waitFor({ state: 'attached', timeout: 15000 }),
      page.waitForURL(/\/closedform/, { timeout: 15000 }).catch(() => {})
    ]).catch(() => {});

    if (page.url().includes('/closedform') || (await page.locator('form').count() === 0)) {
      throw new Error('This Google Form is closed or redirecting to login. Make sure your session cookies are valid.');
    }

    // Inspect DOM
    const questions = await page.evaluate(() => {
      const g = globalThis as any;
      const result: any[] = [];
      const containers = g.document.querySelectorAll('.Qr7Oae');

      containers.forEach((container: any) => {
        const headerEl = container.querySelector('[role="heading"], .M7eMe, .HoRgec');
        if (!headerEl) return;

        let labelText = (headerEl.textContent || '').trim();
        const isRequired = labelText.endsWith('*');
        labelText = labelText.replace(/\s*\*$/, '').trim();

        let type = 'text';
        let choices: string[] = [];
        let allowOther = false;

        const paramsEl = container.hasAttribute('data-params') ? container : container.querySelector('[data-params]');
        if (paramsEl) {
          const dataParams = paramsEl.getAttribute('data-params');
          try {
            // Replace Google Forms prefix with '[' to restore the outer array opening bracket
            const jsonText = dataParams.replace(/^%\.@\./, '[');
            const parsed = JSON.parse(jsonText);
            const questionInfo = parsed[0];
            const typeId = questionInfo[3];
            
            if (typeId === 11 || typeId === 13) {
              type = 'file';
            } else if (typeId === 9) {
              type = 'date';
            } else if (typeId === 1) {
              type = 'paragraph';
            } else if (typeId === 2 || typeId === 3 || typeId === 4) {
              type = 'choice';
              const choicesArray = questionInfo[4]?.[0]?.[1];
              if (choicesArray && Array.isArray(choicesArray)) {
                choices = choicesArray.map((c: any) => c[0]).filter((val) => val !== null && val !== undefined && val !== '');
              }
              allowOther = !!questionInfo[4]?.[0]?.[2];
            }
          } catch (e: any) {
            console.error('PAGE LOG [Parser Error]:', e.message, 'Data:', dataParams);
            // Fallback to legacy DOM checks if parse fails
            if (container.querySelector('[type="file"]') || container.querySelector('[data-params*="file"]')) {
              type = 'file';
            } else if (container.querySelector('input[type="date"]') || container.querySelector('[data-params*="[[3,"]')) {
              type = 'date';
            } else if (container.querySelector('[role="radio"], [role="checkbox"], select, .SGZTVe')) {
              type = 'choice';
              const optionEls = container.querySelectorAll('[role="radio"] + *, [role="checkbox"] + *, option, .fwW70c, .text');
              optionEls.forEach((opt: any) => {
                const text = (opt.textContent || '').trim();
                if (text && !text.toLowerCase().includes('другое') && !text.toLowerCase().includes('other')) {
                  choices.push(text);
                }
              });
            } else if (container.querySelector('textarea')) {
              type = 'paragraph';
            }
          }
        } else {
          console.warn('PAGE LOG: paramsEl not found for label:', labelText);
        }

        result.push({
          label: labelText,
          type,
          required: isRequired,
          choices: choices.length > 0 ? [...new Set(choices)] : undefined,
          allowOther: allowOther || undefined
        });
      });

      return result;
    });

    console.log(`\n🎉 Introspected ${questions.length} fields successfully. Generating schema objects...\n`);

    const jsonProperties: Record<string, any> = {};
    const jsonRequired: string[] = [];
    const mappingSchema: Record<string, any> = {};

    for (const q of questions) {
      const key = toCamelCase(q.label);

      // JSON Schema building
      if (q.type === 'file') {
        jsonProperties[key] = {
          type: 'object',
          properties: {
            fileId: { type: 'string' },
            buffer: { type: 'object' },
            filename: { type: 'string' },
            mimeType: { type: 'string' }
          },
          required: ['filename', 'mimeType']
        };
      } else if (q.type === 'choice') {
        jsonProperties[key] = {
          type: 'string'
        };
        if (q.choices && q.choices.length > 0) {
          jsonProperties[key].enum = q.choices;
        }
      } else {
        jsonProperties[key] = {
          type: 'string'
        };
        if (q.type === 'date') {
          jsonProperties[key].pattern = '^\\d{4}-\\d{2}-\\d{2}$';
        }
      }

      if (q.required) {
        jsonRequired.push(key);
      }

      // Mapping Schema building
      mappingSchema[key] = {
        label: q.label,
        type: q.type
      };
      if (q.type === 'choice') {
        mappingSchema[key].options = {
          choices: q.choices || []
        };
        if (q.allowOther) {
          mappingSchema[key].options.allowOther = true;
        }
      }
    }

    const finalJsonSchema = {
      type: 'object',
      properties: jsonProperties,
      required: jsonRequired
    };

    // Print TypeScript output
    console.log('// ==========================================');
    console.log('// GENERATED SCHEMAS FOR GOOGLE FORM');
    console.log('// ==========================================');
    console.log('\nexport const JSON_SCHEMA = ' + JSON.stringify(finalJsonSchema, null, 2) + ';\n');
    console.log('export const MAPPING_SCHEMA = ' + JSON.stringify(mappingSchema, null, 2) + ';\n');

  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error('❌ Error during form introspection:', err.message);
  process.exit(1);
});
