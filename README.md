# Google Form Submitter

Пакет для строго типизированной, валидируемой и кэшируемой отправки данных во внешние (в том числе сторонние) Google Формы с использованием Lightpanda (CDP-соединение) или стандартного Chromium.

## 🚀 Возможности

1. **Строгая валидация (JSON Schema)**: Входные данные проверяются через стандартную JSON схему с использованием библиотеки `Ajv` перед любой сетевой отправкой.
2. **Декларативное описание полей**: Позволяет сопоставлять программные свойства (например, `fullName`, `exitDate`) с русскими заголовками вопросов в Google Форме.
3. **Ленивый парсинг DOM (Lazy Loading)**: При первой отправке модуль автоматически открывает форму в безголовом браузере, сканирует структуру вопросов, находит соответствующие им бэкенд `entryId` и сохраняет карту соответствий в локальный кэш-файл.
4. **Сверхбыстрые повторные отправки**: После наполнения кэша последующие отправки выполняются мгновенно через прямой HTTP POST-запрос, эмулируя отправку формы без запуска графического браузера.
5. **Авторизация (Куки)**: Поддерживает инжекцию файлов куки для прохождения авторизации в формах, требующих аккаунт Google (например, если в форме есть поле загрузки файла).
6. **Поддержка опции «Другое»**: Автоматически распознает кастомные текстовые ответы для радио-кнопок/чекбоксов с выбором «Другое» и правильно их кодирует.

---

## 🛠️ Установка и Запуск

Перейдите в каталог `googleformsubmitter` и установите зависимости:
```bash
cd googleformsubmitter
bun install
```

### Доступные скрипты:
* **Запуск тестов**:
  ```bash
  bun run test
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

## 📋 Описание Схемы данных

Отправка настраивается с помощью двух схем:

1. **JSON Schema** — описывает типы данных, ограничения, обязательность и формат (например, регулярные выражения для дат).
2. **Mapping Schema** — описывает связь между ключом в JSON схеме и человекочитаемым заголовком вопроса в Google Форме.

### Пример декларативной конфигурации:

```typescript
import { GoogleFormSubmitter } from './GoogleFormSubmitter';

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
        fileId: { type: 'string' },
        filename: { type: 'string' },
        mimeType: { type: 'string' }
      },
      required: ['fileId', 'filename', 'mimeType']
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
  cookies: loadedCookies          // Сессионные куки (необязательно)
});

// 4. Отправка данных
const result = await submitter.submit({
  fullName: 'Иванов Иван',
  birthDate: '1990-01-01',
  inStaff: 'С рынка, на предоффере', // Будет передано в "Другое"
  cvFile: {
    fileId: '1BRVwwPlohb_4g7DUZ3HTz...',
    filename: 'resume.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
});
```

---

## 📂 Структура каталогов проекта

* `GoogleFormSubmitter.ts` — основной класс управления, парсинга DOM и сетевых запросов.
* `create-form.ts` — скрипт автоматического создания тестовой Google-формы со всеми необходимыми типами полей (включая текстовые, списки, даты, переключатели) через официальный Google Forms API.
* `test.ts` — интеграционный тест, эмулирующий первую отправку (с динамическим парсингом) и повторную отправку (из кэша).
* `types.ts` — TypeScript-интерфейсы и типы данных.
* `.data/` — каталог для хранения временных кэшей сопоставлений entryId (`form-cache-*.json`).
* `.env.example` — шаблон конфигурационного файла.
