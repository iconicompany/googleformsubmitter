import { describe, expect, test } from 'bun:test';
import path from 'path';

import { parseFormDefinition } from './form-definition';

/**
 * Real page of our own three-section test form, fetched anonymously from
 * https://docs.google.com/forms/d/e/1FAIpQLSe3464D_Oal2pGu8ph1jLs7XrujHJ-DbiIpzvVf0UsGNvekGw/viewform
 * (rebuild it with `bun run create-test-form multi`)
 *
 * Its first section carries only the intro text and a "Далее" button — the shape that makes a
 * single-page DOM scan see zero questions.
 */
const multipageHtml = await Bun.file(
  path.join(import.meta.dir, '__fixtures__', 'multipage-form.html')
).text();

/**
 * The same questions with the section breaks removed, fetched anonymously from
 * https://docs.google.com/forms/d/e/1FAIpQLSdJCkdmCZ_zyUv9cN8BaEXZaG6y_DCYJHcYo6ZmvBo-8l0qGA/viewform
 * (`bun run create-test-form single`) — the ordinary single-section shape, which must keep
 * working unchanged.
 */
const singlepageHtml = await Bun.file(
  path.join(import.meta.dir, '__fixtures__', 'singlepage-form.html')
).text();

describe('parseFormDefinition', () => {
  test('finds questions that live past the first section', () => {
    const definition = parseFormDefinition(multipageHtml);

    const labels = definition.questions.map((question) => question.label);
    expect(labels).toContain('ID запроса');
    expect(labels).toContain('Грейд');
  });

  test('counts every section, including the one that holds no questions', () => {
    expect(parseFormDefinition(multipageHtml).pageCount).toBe(3);
  });

  test('still reads a single-section form, where every question sits on the first page', () => {
    const definition = parseFormDefinition(singlepageHtml);

    expect(definition.pageCount).toBe(1);
    expect(definition.questions.map(({ entryId, label }) => ({ entryId, label }))).toEqual([
      { entryId: '2056779109', label: 'ID запроса' },
      { entryId: '460509557', label: 'Фамилия' },
      { entryId: '506016267', label: 'Дата рождения' },
      { entryId: '2121666121', label: 'Текущий формат сотрудничества с кандидатом?' },
      { entryId: '665582153', label: 'Грейд' },
      { entryId: '992888357', label: 'Сферы, с которыми специалист работал' },
      { entryId: '515581986', label: 'Чек-лист по требованиям' },
      { entryId: '1196599129', label: 'Комментарий' },
    ]);
  });

  test('reports the type and requiredness of each question', () => {
    const byLabel = new Map(
      parseFormDefinition(multipageHtml).questions.map((question) => [question.label, question])
    );

    expect(byLabel.get('Дата рождения')).toMatchObject({ type: 'date', required: true });
    expect(byLabel.get('Грейд')).toMatchObject({ type: 'choice', required: true });
    expect(byLabel.get('Чек-лист по требованиям')).toMatchObject({
      type: 'paragraph',
      required: true,
    });
    expect(byLabel.get('Комментарий')).toMatchObject({ type: 'paragraph', required: false });
    expect(byLabel.get('ID запроса')).toMatchObject({ type: 'text', required: true });
  });

  test('lists the choices and flags a free-text "other" option instead of listing it', () => {
    const byLabel = new Map(
      parseFormDefinition(multipageHtml).questions.map((question) => [question.label, question])
    );

    expect(byLabel.get('Грейд')).toMatchObject({
      choices: ['junior', 'middle', 'senior', 'Team Lead'],
      allowOther: false,
    });
    // Google represents "Другое" as an empty-valued option carrying the other-flag.
    expect(byLabel.get('Текущий формат сотрудничества с кандидатом?')).toMatchObject({
      choices: ['ТК (уже оформлен)', 'Партнерский специалист', 'Оформим к себе в случае офера'],
      allowOther: true,
    });
    expect(byLabel.get('Комментарий')).toMatchObject({ choices: [], allowOther: false });
  });

  test('refuses a page that is not a Google Form', () => {
    expect(() => parseFormDefinition('<html><body>no form here</body></html>')).toThrow(
      /does not look like a Google Form/
    );
  });
});
