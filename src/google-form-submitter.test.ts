import { describe, expect, test, beforeAll } from 'bun:test';
import { GoogleFormSubmitter } from './google-form-submitter';
import type { FormSchemaMapping } from './types';
import fs from 'fs/promises';
import path from 'path';

// 1. Describe the Form structure using JSON Schema (Standard specification)
const jsonSchema = {
  type: 'object',
  properties: {
    requestId: { type: 'string' },
    fullName: { type: 'string' },
    birthDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    grade: { type: 'string', enum: ['Junior', 'Junior+', 'Middle', 'Middle+', 'Senior', 'Senior+', 'Team Lead'] },
    location: { type: 'string' },
    rate: { type: 'string' },
    nds: { type: 'string', enum: ['5%', '7%', '20%', '22%', 'Нет'] },
    exitDate: { type: 'string' },
    vacation: { type: 'string' },
    inStaff: { type: 'string' },
    cvFile: {
      type: 'object',
      properties: {
        fileId: { type: 'string' },
        buffer: { type: 'object' },
        filename: { type: 'string' },
        mimeType: { type: 'string' }
      },
      required: ['filename', 'mimeType']
    },
    company: { type: 'string' },
    checklist: { type: 'string' },
    comment: { type: 'string' }
  },
  required: [
    'requestId',
    'fullName',
    'birthDate',
    'grade',
    'location',
    'rate',
    'nds',
    'exitDate',
    'vacation',
    'inStaff',
    'cvFile',
    'company',
    'checklist'
  ]
};

// 2. Describe the mapping schema pointing property names to their Form titles/labels
const mappingSchema: FormSchemaMapping = {
  requestId: { label: 'Номер запроса', type: 'text' },
  fullName: { label: 'ФИО (полностью)', type: 'text' },
  birthDate: { label: 'Дата рождения', type: 'date' },
  grade: { label: 'Грейд', type: 'choice', options: { choices: ['Junior', 'Junior+', 'Middle', 'Middle+', 'Senior', 'Senior+', 'Team Lead'] } },
  location: { label: 'Локация (страна, город)', type: 'text' },
  rate: { label: 'Рейт (руб./ч) без НДС', type: 'text' },
  nds: { label: 'Какой у вас НДС:', type: 'choice', options: { choices: ['5%', '7%', '20%', '22%', 'Нет'] } },
  exitDate: { label: 'Когда кандидат сможет выйти на проект', type: 'paragraph' },
  vacation: { label: 'Ближайший планируемый отпуск', type: 'text' },
  inStaff: { label: 'Находится ли специалист в штате?', type: 'choice', options: { choices: ['Да'], allowOther: true } },
  cvFile: { label: 'CV (файл)', type: 'file' },
  company: { label: 'Название вашей компании и контакты для связи', type: 'text' },
  checklist: { label: 'Чек-лист по требованиям', type: 'paragraph' },
  comment: { label: 'Комментарий', type: 'paragraph' }
};

describe('GoogleFormSubmitter E2E Integration', () => {
  let cookies: any[] = [];
  let submitter: GoogleFormSubmitter;

  beforeAll(async () => {
    // Load cookies from local environment path if it exists
    const localCookiesPath = process.env.GOOGLE_COOKIES_PATH || path.join(__dirname, '..', '.data', 'google-cookies.json');
    try {
      const cookiesStr = await fs.readFile(localCookiesPath, 'utf8');
      cookies = JSON.parse(cookiesStr);
      console.log(`[Test] Loaded ${cookies.length} session cookies from ${localCookiesPath}`);
    } catch (err: any) {
      console.warn(`[Test] Warning: Could not load local session cookies: ${err.message}`);
    }

    const formUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSc1aiEAhxWCMSNjZ1asGDtXV_mT8vTiJRquiqfdjsoMkKT9tw/viewform';
    const credentialsPath = path.join(__dirname, '..', '..', 'imatching', '.data', 'credentials.json');
    const tokenPath = path.join(__dirname, '..', '..', 'imatching', '.data', 'gdrive-auth.json');

    submitter = new GoogleFormSubmitter({
      formUrl,
      jsonSchema,
      mappingSchema,
      cdpUrl: 'ws://127.0.0.1:9222/', // CDP endpoint to Lightpanda
      cacheDir: './.data',
      auth: {
        credentialsPath,
        tokenPath
      },
      cookies
    });
  });

  test('should dynamically resolve fields, upload file, and submit successfully', async () => {
    const candidateData = {
      requestId: '910',
      fullName: 'Багманов Алмаз (Схема)',
      birthDate: '1996-07-03',
      grade: 'Middle',
      location: 'Россия, Набережные Челны',
      rate: '2000',
      nds: 'Нет',
      exitDate: 'через 21 дней',
      vacation: 'нет',
      inStaff: 'Да',
      cvFile: {
        buffer: Buffer.from('mock cv file contents for integration test'),
        filename: 'cv_Багманов_Алмаз.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      },
      company: 'Iconicompany',
      checklist: '📊 Чек-лист: 77% (Kotlin, Android, Compose, Coroutines)',
      comment: 'Отправлено автоматически через типизированный маппер.'
    };

    console.log('\n--- FIRST RUN: Performing dynamic DOM-resolution and submission ---');
    const result1 = await submitter.submit(candidateData);
    console.log('Result 1 Fields Submitted:', JSON.stringify(result1.fieldsSubmitted, null, 2));

    expect(result1.success).toBe(true);
    expect(result1.statusCode).toBe(200);

    console.log('\n--- SECOND RUN: Submitting instantly using cache ---');
    candidateData.fullName = 'Багманов Алмаз (Схема-Кэш)';
    const result2 = await submitter.submit(candidateData);
    console.log('Result 2 Fields Submitted:', JSON.stringify(result2.fieldsSubmitted, null, 2));

    expect(result2.success).toBe(true);
    expect(result2.statusCode).toBe(200);
  }, 45000); // 45 seconds timeout
});
