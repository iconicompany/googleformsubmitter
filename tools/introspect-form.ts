import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

import { parseFormDefinition } from '../src/form-definition';

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

    // Wait for the form itself, not for a question container: a form whose first section is just
    // an intro has none, and waiting for one would burn the timeout and then blame the cookies.
    await Promise.any([
      page.locator('form').first().waitFor({ state: 'attached', timeout: 15000 }),
      page.waitForURL(/\/closedform/, { timeout: 15000 })
    ]).catch(() => {});

    if (page.url().includes('/closedform') || (await page.locator('form').count() === 0)) {
      throw new Error('This Google Form is closed or redirecting to login. Make sure your session cookies are valid.');
    }

    // Read the form's own definition: the DOM only holds the section currently on screen, so a
    // scan of `/viewform` misses every question on a later section — all of them, when the first
    // section is just an intro.
    const definition = parseFormDefinition(await page.content());
    const questions = definition.questions.filter((question) => question.label !== '');

    console.log(
      `\n🎉 Introspected ${questions.length} fields across ${definition.pageCount} section(s). Generating schema objects...\n`
    );

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
