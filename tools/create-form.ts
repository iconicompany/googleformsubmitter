import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { google } from 'googleapis';
import { authenticate } from '@google-cloud/local-auth';

// Helper to check if file exists
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolvePaths() {
  let credentialsPath = path.join(process.cwd(), '.data', 'credentials.json');
  let tokenPath = path.join(process.cwd(), '.data', 'forms-auth.json');

  // Fallback to parent directory if not found in current directory
  if (!(await fileExists(credentialsPath))) {
    const parentCreds = path.join(process.cwd(), '..', '.data', 'credentials.json');
    if (await fileExists(parentCreds)) {
      credentialsPath = parentCreds;
    }
  }

  if (!(await fileExists(tokenPath))) {
    const parentToken = path.join(process.cwd(), '..', '.data', 'forms-auth.json');
    if (await fileExists(parentToken)) {
      tokenPath = parentToken;
    }
  }

  return { credentialsPath, tokenPath };
}

const SCOPES = [
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/drive'
];

async function loadSavedCredentialsIfExist(tokenPath: string) {
  try {
    const content = await fs.readFile(tokenPath, 'utf-8');
    const credentials = JSON.parse(content);
    
    const oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret
    );
    oauth2Client.setCredentials({ refresh_token: credentials.refresh_token });
    return oauth2Client;
  } catch (err) {
    return null;
  }
}

async function saveCredentials(refreshToken: string, credentialsPath: string, tokenPath: string): Promise<void> {
  const content = await fs.readFile(credentialsPath, 'utf-8');
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: refreshToken,
  });
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, payload);
}

async function authorize(credentialsPath: string, tokenPath: string) {
  const saved = await loadSavedCredentialsIfExist(tokenPath);
  if (saved) return saved;

  console.log('Triggering new authentication flow for Google Forms & Drive...');
  const client = await authenticate({
    scopes: SCOPES,
    keyfilePath: credentialsPath,
  });

  const refreshToken = client.credentials.refresh_token;
  if (refreshToken) {
    await saveCredentials(refreshToken, credentialsPath, tokenPath);
  }

  const content = await fs.readFile(credentialsPath, 'utf-8');
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const oauth2Client = new google.auth.OAuth2(
    key.client_id,
    key.client_secret,
    key.redirect_uris?.[0]
  );
  oauth2Client.setCredentials(client.credentials);
  return oauth2Client;
}

async function main() {
  const { credentialsPath, tokenPath } = await resolvePaths();

  await fs.access(credentialsPath).catch(() => {
    console.error(`❌ Error: Credentials file not found at ${credentialsPath}`);
    console.log('Please place your Google Cloud credentials.json in the .data directory.');
    process.exit(1);
  });

  const auth = await authorize(credentialsPath, tokenPath);
  const forms = google.forms({ version: 'v1', auth });

  console.log('Creating new Google Form...');
  const formRes = await forms.forms.create({
    requestBody: {
      info: {
        title: "Анкета для отправки кандидата на рассмотрение (Копия)"
      }
    }
  });

  const formId = formRes.data.formId!;
  const responderUri = formRes.data.responderUri!;
  console.log(`Created Form ID: ${formId}`);

  console.log('Adding questions to the form...');
  
  const requests = [
    // 1. Update form description
    {
      updateFormInfo: {
        info: {
          description: "Заполните, пожалуйста, информацию по направляемому кандидату"
        },
        updateMask: "description"
      }
    },
    // 2. Add "Номер запроса" (Required, Short Text)
    {
      createItem: {
        item: {
          title: "Номер запроса",
          questionItem: {
            question: {
              required: true,
              textQuestion: {}
            }
          }
        },
        location: { index: 0 }
      }
    },
    // 3. Add "ФИО (полностью)" (Required, Short Text)
    {
      createItem: {
        item: {
          title: "ФИО (полностью)",
          questionItem: {
            question: {
              required: true,
              textQuestion: {}
            }
          }
        },
        location: { index: 1 }
      }
    },
    // 4. Add "Дата рождения" (Required, Date)
    {
      createItem: {
        item: {
          title: "Дата рождения",
          questionItem: {
            question: {
              required: true,
              dateQuestion: {
                includeYear: true,
                includeTime: false
              }
            }
          }
        },
        location: { index: 2 }
      }
    },
    // 5. Add "Грейд" (Required, Dropdown)
    {
      createItem: {
        item: {
          title: "Грейд",
          questionItem: {
            question: {
              required: true,
              choiceQuestion: {
                type: "DROP_DOWN",
                options: [
                  { value: "Junior" },
                  { value: "Junior+" },
                  { value: "Middle" },
                  { value: "Middle+" },
                  { value: "Senior" },
                  { value: "Senior+" },
                  { value: "Team Lead" }
                ]
              }
            }
          }
        },
        location: { index: 3 }
      }
    },
    // 6. Add "Локация (страна, город)" (Required, Short Text)
    {
      createItem: {
        item: {
          title: "Локация (страна, город)",
          questionItem: {
            question: {
              required: true,
              textQuestion: {}
            }
          }
        },
        location: { index: 4 }
      }
    },
    // 7. Add "Рейт (руб./ч) без НДС " (Required, Short Text)
    {
      createItem: {
        item: {
          title: "Рейт (руб./ч) без НДС ",
          questionItem: {
            question: {
              required: true,
              textQuestion: {}
            }
          }
        },
        location: { index: 5 }
      }
    },
    // 8. Add "Какой у вас НДС: " (Required, Multiple Choice)
    {
      createItem: {
        item: {
          title: "Какой у вас НДС: ",
          questionItem: {
            question: {
              required: true,
              choiceQuestion: {
                type: "RADIO",
                options: [
                  { value: "5%" },
                  { value: "7%" },
                  { value: "20%" },
                  { value: "22%" },
                  { value: "Нет" }
                ]
              }
            }
          }
        },
        location: { index: 6 }
      }
    },
    // 9. Add "Когда кандидат сможет выйти на проект" (Required, Paragraph)
    {
      createItem: {
        item: {
          title: "Когда кандидат сможет выйти на проект",
          questionItem: {
            question: {
              required: true,
              textQuestion: {
                paragraph: true
              }
            }
          }
        },
        location: { index: 7 }
      }
    },
    // 10. Add "Ближайший планируемый отпуск" (Required, Short Text)
    {
      createItem: {
        item: {
          title: "Ближайший планируемый отпуск",
          questionItem: {
            question: {
              required: true,
              textQuestion: {}
            }
          }
        },
        location: { index: 8 }
      }
    },
    // 11. Add "Находится ли специалист в штате? " (Required, Multiple Choice)
    {
      createItem: {
        item: {
          title: "Находится ли специалист в штате? ",
          description: "⚠️ [ВНИМАНИЕ] В веб-редакторе формы обязательно нажмите кнопку \"Добавить вариант 'Другое'\" (Add 'Other') для этого вопроса.",
          questionItem: {
            question: {
              required: true,
              choiceQuestion: {
                type: "RADIO",
                options: [
                  { value: "Да" }
                ]
              }
            }
          }
        },
        location: { index: 9 }
      }
    },
    // 12. Add PLACEHOLDER for CV (файл)
    {
      createItem: {
        item: {
          title: "CV (файл) ",
          description: "⚠️ [ВНИМАНИЕ] Google Forms API запрещает программное создание полей 'Загрузка файла'. Пожалуйста, перейдите в веб-интерфейс редактирования формы по ссылке ниже и вручную измените тип этого вопроса с 'Текст (строка)' на 'Загрузка файлов' (File Upload). Назовите вопрос именно 'CV (файл) ', сделайте его обязательным и укажите разрешённые типы: только DOC/DOCX, размер до 10 МБ.",
          questionItem: {
            question: {
              required: true,
              textQuestion: {}
            }
          }
        },
        location: { index: 10 }
      }
    },
    // 13. Add "Название вашей компании и контакты для связи" (Required, Short Text)
    {
      createItem: {
        item: {
          title: "Название вашей компании и контакты для связи",
          description: "Пример: 65apps, ТГ - @Elizaveta_Kalinina",
          questionItem: {
            question: {
              required: true,
              textQuestion: {}
            }
          }
        },
        location: { index: 11 }
      }
    },
    // 14. Add "Чек-лист по требованиям " (Required, Paragraph)
    {
      createItem: {
        item: {
          title: "Чек-лист по требованиям ",
          questionItem: {
            question: {
              required: true,
              textQuestion: {
                paragraph: true
              }
            }
          }
        },
        location: { index: 12 }
      }
    },
    // 15. Add "Комментарий" (Optional, Paragraph)
    {
      createItem: {
        item: {
          title: "Комментарий",
          questionItem: {
            question: {
              required: false,
              textQuestion: {
                paragraph: true
              }
            }
          }
        },
        location: { index: 13 }
      }
    }
  ];

  await forms.forms.batchUpdate({
    formId,
    requestBody: {
      requests
    }
  });

  console.log('\n🎉 Google Form has been successfully created!');
  console.log(`🔗 Link to edit (Google Forms Owner Web UI):`);
  console.log(`   https://docs.google.com/forms/d/${formId}/edit`);
  console.log(`🔗 Link to fill (Responder Web UI):`);
  console.log(`   ${responderUri}`);
  console.log('\n⚠️  IMPORTANT NOTES:');
  console.log('  1. Since Google Forms API forbids programmatic creation of File Upload fields,');
  console.log('     the question "CV (файл) " was created as a standard text field.');
  console.log('     You must open the edit link above and manually change the type of "CV (файл) " to "File Upload" (Загрузка файлов).');
  console.log('  2. For the question "Находится ли специалист в штате?", you must click "Добавить вариант \'Другое\'" (Add \'Other\')');
  console.log('     in the edit UI so custom answers like "С рынка, на предоффере" can be submitted.');
}

main().catch((err) => {
  console.error('❌ Failed to create Google Form:', err);
  process.exit(1);
});
