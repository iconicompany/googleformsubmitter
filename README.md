# Google Form Submitter

Пакет для строго типизированной, валидируемой и кэшируемой отправки данных во внешние (в том числе сторонние) Google Формы с использованием Lightpanda (CDP-соединение) или стандартного Chromium.

---

## 🚀 Возможности

1. **Строгая валидация (JSON Schema)**: Входные данные проверяются через стандартную JSON схему с использованием библиотеки `Ajv` перед любой сетевой отправкой.
2. **Декларативное описание полей**: Позволяет сопоставлять программные свойства (например, `fullName`, `exitDate`) с русскими заголовками вопросов в Google Форме.
3. **Ленивый парсинг DOM (Lazy Loading)**: При первой отправке модуль автоматически открывает форму в безголовом браузере, сканирует структуру вопросов, находит соответствующие им бэкенд `entryId` и сохраняет карту соответствий в локальный кэш-файл.
4. **Сверхбыстрые повторные отправки**: После наполнения кэша последующие отправки выполняются мгновенно через прямой HTTP POST-запрос, эмулируя отправку формы без запуска графического браузера.
5. **Авторизация и загрузка файлов (Google Drive)**: Поддерживает инжекцию файлов куки для прохождения авторизации в формах, требующих аккаунт Google. Также инкапсулирует автоматическую загрузку файлов резюме (`Buffer`) на Google Диск через Google Drive API на лету с подстановкой ID файла в форму.
6. **Поддержка опции «Другое»**: Автоматически распознает кастомные текстовые ответы для радио-кнопок/чекбоксов с выбором «Другое» и правильно их кодирует.
7. **Инфраструктурная чистота**: Библиотека полностью независима от файловой структуры или конкретных `env`-переменных вашего приложения. Все настройки и пути передаются в конструктор.

---

## 🛠️ Установка и Запуск

Перейдите в каталог библиотеки и установите зависимости:
```bash
cd googleformsubmitter
bun install
```

### Доступные скрипты:
* **Запуск тестов (стандартный Bun BDD runner)**:
  ```bash
  bun test
  ```
* **Проверка типов (tsgo)**:
  ```bash
  bun run validate
  ```
* **Линтинг (oxlint)**:
  ```bash
  bun run lint
  ```
* **Создание тестовой Google Формы**:
  ```bash
  bun run create-form
  ```

---

## 🐼 Запуск Lightpanda

Для динамического разрешения DOM-структуры (когда кэш еще не заполнен) библиотека использует CDP-соединение с ультра-легким JS-движком **Lightpanda**. 

Для его локального запуска выполните:
```bash
docker run --rm -p 9222:9222 lightpanda/browser:latest
```

*При отсутствии запущенного инстанса Lightpanda библиотека автоматически переключится на стандартный headless Chromium в качестве безопасного fallback.*

---

## 🩹 Патч Playwright для работы под Bun

В среде выполнения **Bun** есть известная проблема совместимости с CDP-событиями WebSocket, из-за которой стандартный Playwright зависает (hangs) при подключении к Lightpanda.

Для решения этой проблемы библиотека поставляется со встроенным патчем:
* Файл патча: `patches/playwright-core@1.61.1.patch`
* Регистрация в `package.json` через `"patchedDependencies"`.

При запуске `bun install` патч применяется автоматически.

---

## 📋 Описание Схемы данных

Отправка настраивается с помощью двух схем:

1. **JSON Schema** — описывает типы данных, ограничения, обязательность и формат.
2. **Mapping Schema** — описывает связь между ключом в JSON схеме и человекочитаемым заголовком вопроса в Google Форме.

### Пример декларативной конфигурации:

```typescript
import { GoogleFormSubmitter } from 'googleformsubmitter';

// 1. Описание типов данных формы (JSON Schema)
const jsonSchema = {
  type: 'object',
  properties: {
    fullName: { type: 'string' },
    birthDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    inStaff: { type: 'string' },
    cvFile: {
      type: 'object',
      properties: {
        buffer: { type: 'object' },
        filename: { type: 'string' },
        mimeType: { type: 'string' }
      },
      required: ['filename', 'mimeType']
    }
  },
  required: ['fullName', 'birthDate', 'inStaff', 'cvFile']
};

// 2. Декларативный маппинг полей на заголовки вопросов в Google Форме
const mappingSchema = {
  fullName: { label: 'ФИО (полностью)', type: 'text' },
  birthDate: { label: 'Дата рождения', type: 'date' },
  inStaff: { label: 'Находится ли специалист в штате?', type: 'choice', options: { choices: ['Да'], allowOther: true } },
  cvFile: { label: 'CV (файл)', type: 'file' }
};

// 3. Инициализация сабмиттера
const submitter = new GoogleFormSubmitter({
  formUrl: 'https://docs.google.com/forms/d/e/.../viewform',
  jsonSchema,
  mappingSchema,
  cdpUrl: 'ws://127.0.0.1:9222/', // CDP-сервер Lightpanda
  cacheDir: './.data',            // Папка для кэширования entryId
  cookies: loadedCookies,         // Сессионные куки (для авторизованных форм)
  
  // Конфигурация авторизации Google Auth (Drive API)
  auth: {
    // Вариант А: Программная передача токенов напрямую (рекомендуется для Production/CI)
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,

    // Вариант Б: Явные пути к конфигурационным файлам на диске
    // credentialsPath: './.data/credentials.json',
    // tokenPath: './.data/forms-auth.json'
  }
});

// 4. Отправка данных
const result = await submitter.submit({
  fullName: 'Иванов Иван',
  birthDate: '1990-01-01',
  inStaff: 'С рынка, на предоффере', // Будет передано в "Другое"
  cvFile: {
    buffer: resumeBuffer,
    filename: 'resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
});
```

---

## 📂 Структура каталогов проекта

* `src/google-form-submitter.ts` — основной класс управления, парсинга DOM и сетевых запросов.
* `src/google-auth-service.ts` — сервис авторизации Google OAuth2 (поддерживает как токены из конструктора/env, так и из файлов).
* `src/google-drive-service.ts` — сервис загрузки файлов на Google Диск через Google Drive API.
* `src/types.ts` — TypeScript-интерфейсы и типы данных.
* `src/index.ts` — точка входа (публичные экспорты библиотеки).
* `src/google-form-submitter.test.ts` — BDD интеграционный тест (запускается через `bun test`).
* `tools/create-form.ts` — вспомогательный скрипт создания тестовой формы через Google Forms API.
* `patches/` — содержит патч для решения проблем с CDP Playwright под Bun.
