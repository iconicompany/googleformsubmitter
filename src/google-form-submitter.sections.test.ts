import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { GoogleFormSubmitter } from './google-form-submitter';
import type { FormSchemaMapping } from './types';

/**
 * Two of our own test forms holding the SAME questions, differing only in whether they are split
 * into sections. The multi-section one is intro-only on section 1, so `/viewform` renders no
 * questions at all and every answered field lives on sections 2 and 3.
 */
const FORMS: Array<{ shape: string; url: string }> = [
  {
    shape: 'three sections',
    url: 'https://docs.google.com/forms/d/e/1FAIpQLSe3464D_Oal2pGu8ph1jLs7XrujHJ-DbiIpzvVf0UsGNvekGw/viewform',
  },
  {
    shape: 'one section',
    url: 'https://docs.google.com/forms/d/e/1FAIpQLSdJCkdmCZ_zyUv9cN8BaEXZaG6y_DCYJHcYo6ZmvBo-8l0qGA/viewform',
  },
];

const jsonSchema = {
  type: 'object',
  properties: {
    requestId: { type: 'string' },
    lastName: { type: 'string' },
    birthDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    cooperation: { type: 'string' },
    grade: { type: 'string' },
    industry: { type: 'string' },
    checklist: { type: 'string' },
    comment: { type: 'string' },
  },
  required: [
    'requestId',
    'lastName',
    'birthDate',
    'cooperation',
    'grade',
    'industry',
    'checklist',
  ],
};

/** On the sectioned form the first four sit on section 2 and the rest on section 3. */
const ALL_LABELS = [
  'ID запроса',
  'Фамилия',
  'Дата рождения',
  'Текущий формат сотрудничества с кандидатом?',
  'Грейд',
  'Сферы, с которыми специалист работал',
  'Чек-лист по требованиям',
  'Комментарий',
];

const mappingSchema: FormSchemaMapping = {
  requestId: { label: 'ID запроса', type: 'text' },
  lastName: { label: 'Фамилия', type: 'text' },
  birthDate: { label: 'Дата рождения', type: 'date' },
  cooperation: {
    label: 'Текущий формат сотрудничества с кандидатом?',
    type: 'choice',
    options: { choices: ['ТК (уже оформлен)', 'Партнерский специалист', 'Оформим к себе в случае офера'] },
  },
  grade: {
    label: 'Грейд',
    type: 'choice',
    options: { choices: ['junior', 'middle', 'senior', 'Team Lead'] },
  },
  industry: {
    label: 'Сферы, с которыми специалист работал',
    type: 'choice',
    options: { choices: ['FinTech', 'EdTech', 'Telecom'] },
  },
  checklist: { label: 'Чек-лист по требованиям', type: 'paragraph' },
  comment: { label: 'Комментарий', type: 'paragraph' },
};

const candidate = {
  requestId: 'REQ-338',
  lastName: 'Тестов',
  birthDate: '1996-06-09',
  cooperation: 'Партнерский специалист',
  grade: 'senior',
  industry: 'FinTech',
  checklist: 'Чек-лист: 100%',
  comment: 'Отправлено интеграционным тестом многостраничной формы.',
};

describe.each(FORMS)('GoogleFormSubmitter on a form of $shape', ({ url }) => {
  let cacheDir: string;
  let submitter: GoogleFormSubmitter;

  beforeAll(async () => {
    // A fresh cache dir forces real resolution instead of reusing a previous run's entry ids.
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gfs-sections-'));
    submitter = new GoogleFormSubmitter({ formUrl: url, jsonSchema, mappingSchema, cacheDir });
  });

  afterAll(async () => {
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  test('resolves and submits every question, whichever section it sits on', async () => {
    const result = await submitter.submit(candidate);

    expect(result.success).toBe(true);
    expect(Object.keys(result.fieldsSubmitted).sort()).toEqual([...ALL_LABELS].sort());
  }, 90000);
});
