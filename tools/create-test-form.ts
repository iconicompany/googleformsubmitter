/**
 * Creates the Google Forms used as test fixtures, on our own account.
 *
 * `multi` builds a form whose FIRST section holds only an intro and a "Next" button — the shape
 * that defeats a single-page scan, because `/viewform` then renders no questions at all.
 * `single` builds the ordinary one-section form, so the common case stays covered too.
 *
 * Usage: bun run create-test-form [multi|single]
 */
import fs from 'fs/promises';
import path from 'path';
import process from 'process';

import { authenticate } from '@google-cloud/local-auth';
import { auth as googleAuth, forms as formsApi, type forms_v1 } from '@googleapis/forms';

const SCOPES = ['https://www.googleapis.com/auth/forms.body', 'https://www.googleapis.com/auth/drive'];

/**
 * `@googleapis/forms` bundles its own copy of google-auth-library, so the client must come from
 * its `auth` export — a client imported from the top-level copy is a different, incompatible type.
 */
type FormsAuthClient = InstanceType<typeof googleAuth.OAuth2>;

type FormMode = 'multi' | 'single';

type ClientKey = {
  client_id: string;
  client_secret: string;
  redirect_uris?: string[];
};

type SavedToken = {
  client_id: string;
  client_secret: string;
  refresh_token: string;
};

async function readClientKey(credentialsPath: string): Promise<ClientKey> {
  const raw = JSON.parse(await fs.readFile(credentialsPath, 'utf-8')) as {
    installed?: ClientKey;
    web?: ClientKey;
  };
  const key = raw.installed ?? raw.web;
  if (!key) throw new Error(`${credentialsPath} has neither "installed" nor "web" client`);
  return key;
}

async function loadSavedToken(tokenPath: string): Promise<FormsAuthClient | null> {
  try {
    const saved = JSON.parse(await fs.readFile(tokenPath, 'utf-8')) as SavedToken;
    const client = new googleAuth.OAuth2(saved.client_id, saved.client_secret);
    client.setCredentials({ refresh_token: saved.refresh_token });
    // Prove the token still works: a revoked refresh token only fails on use.
    await client.getAccessToken();
    return client;
  } catch {
    return null;
  }
}

async function authorize(credentialsPath: string, tokenPath: string): Promise<FormsAuthClient> {
  const saved = await loadSavedToken(tokenPath);
  if (saved) {
    console.log('Using the saved token.');
    return saved;
  }

  console.log('Opening the browser for Google consent (forms.body + drive)...');
  const consented = await authenticate({ scopes: SCOPES, keyfilePath: credentialsPath });
  const key = await readClientKey(credentialsPath);

  const refreshToken = consented.credentials.refresh_token;
  if (refreshToken) {
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(
      tokenPath,
      JSON.stringify({
        type: 'authorized_user',
        client_id: key.client_id,
        client_secret: key.client_secret,
        refresh_token: refreshToken,
      })
    );
    console.log(`Saved the refresh token to ${tokenPath}`);
  }

  const client = new googleAuth.OAuth2(key.client_id, key.client_secret, key.redirect_uris?.[0]);
  client.setCredentials({
    refresh_token: refreshToken ?? undefined,
    access_token: consented.credentials.access_token ?? undefined,
    expiry_date: consented.credentials.expiry_date ?? undefined,
  });
  return client;
}

/**
 * The same questions either way; `single` simply drops the section breaks, so the two fixtures
 * differ in exactly the thing under test.
 */
function buildRequests(mode: FormMode): forms_v1.Schema$Request[] {
  const requests: forms_v1.Schema$Request[] = [
    {
      updateFormInfo: {
        info: {
          description:
            mode === 'multi'
              ? 'ЧИТАТЬ ОБЯЗАТЕЛЬНО! Вступительная секция без вопросов — дальше по кнопке «Далее».'
              : 'Одностраничная форма: все вопросы в первой секции.',
        },
        updateMask: 'description',
      },
    },
  ];

  const allItems: forms_v1.Schema$Item[] = [
    { title: 'Информация о кандидате', pageBreakItem: {} },
    {
      title: 'ID запроса',
      questionItem: { question: { required: true, textQuestion: {} } },
    },
    {
      title: 'Фамилия',
      questionItem: { question: { required: true, textQuestion: {} } },
    },
    {
      title: 'Дата рождения',
      questionItem: {
        question: { required: true, dateQuestion: { includeYear: true, includeTime: false } },
      },
    },
    {
      title: 'Текущий формат сотрудничества с кандидатом?',
      questionItem: {
        question: {
          required: true,
          choiceQuestion: {
            type: 'RADIO',
            // The trailing free-text option is what `allowOther` in a mapping schema describes.
            options: [
              { value: 'ТК (уже оформлен)' },
              { value: 'Партнерский специалист' },
              { value: 'Оформим к себе в случае офера' },
              { isOther: true },
            ],
          },
        },
      },
    },
    { title: 'Скиллы и навыки', pageBreakItem: {} },
    {
      title: 'Грейд',
      questionItem: {
        question: {
          required: true,
          choiceQuestion: {
            type: 'DROP_DOWN',
            options: [
              { value: 'junior' },
              { value: 'middle' },
              { value: 'senior' },
              { value: 'Team Lead' },
            ],
          },
        },
      },
    },
    {
      title: 'Сферы, с которыми специалист работал',
      questionItem: {
        question: {
          required: true,
          choiceQuestion: {
            type: 'CHECKBOX',
            options: [{ value: 'FinTech' }, { value: 'EdTech' }, { value: 'Telecom' }],
          },
        },
      },
    },
    {
      title: 'Чек-лист по требованиям',
      questionItem: { question: { required: true, textQuestion: { paragraph: true } } },
    },
    {
      title: 'Комментарий',
      questionItem: { question: { required: false, textQuestion: { paragraph: true } } },
    },
  ];

  const items = allItems.filter((item) => mode === 'multi' || !item.pageBreakItem);
  items.forEach((item, index) => {
    requests.push({ createItem: { item, location: { index } } });
  });

  return requests;
}

async function main(): Promise<void> {
  const requested = process.argv[2] ?? 'multi';
  if (requested !== 'multi' && requested !== 'single') {
    console.error(`Unknown mode "${requested}". Usage: bun run create-test-form [multi|single]`);
    process.exit(1);
  }
  const mode: FormMode = requested;

  const credentialsPath = path.join(process.cwd(), '.data', 'credentials.json');
  const tokenPath = path.join(process.cwd(), '.data', 'forms-auth.json');

  await fs.access(credentialsPath).catch(() => {
    console.error(`Credentials file not found at ${credentialsPath}`);
    process.exit(1);
  });

  const auth = await authorize(credentialsPath, tokenPath);
  const forms = formsApi({ version: 'v1', auth });

  const created = await forms.forms.create({
    requestBody: {
      info: {
        title:
          mode === 'multi'
            ? 'Многостраничная форма для тестов googleformsubmitter'
            : 'Одностраничная форма для тестов googleformsubmitter',
      },
    },
  });

  const formId = created.data.formId;
  const responderUri = created.data.responderUri;
  if (!formId || !responderUri) throw new Error('Forms API returned no formId/responderUri');

  await forms.forms.batchUpdate({ formId, requestBody: { requests: buildRequests(mode) } });

  console.log(`\nForm created.`);
  console.log(`  edit : https://docs.google.com/forms/d/${formId}/edit`);
  console.log(`  view : ${responderUri}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
