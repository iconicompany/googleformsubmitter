/**
 * Reads the form's own definition out of the page.
 *
 * Every `/viewform` page embeds `FB_PUBLIC_LOAD_DATA_` — the whole form, all sections at once,
 * even though the DOM only ever renders the current one. Scanning the DOM therefore sees the
 * first section and nothing else; a multi-section form whose first section is just an intro
 * looks like a form with no questions at all.
 */

import type { FormFieldMapping } from './types';

type RawArray = unknown[];

/** Item type code for a section break in `FB_PUBLIC_LOAD_DATA_`. */
const PAGE_BREAK_TYPE = 8;

/** Kept in the vocabulary of a mapping schema so introspection can emit one directly. */
export type FormQuestionType = FormFieldMapping['type'];

const QUESTION_TYPE_BY_CODE: Record<number, FormQuestionType> = {
  0: 'text',
  1: 'paragraph',
  2: 'choice',
  3: 'choice',
  4: 'choice',
  9: 'date',
  11: 'file',
  13: 'file',
};

export interface FormQuestion {
  /** The digits in `entry.<id>`. */
  entryId: string;
  /** Question title, as shown to the responder. */
  label: string;
  type: FormQuestionType;
  required: boolean;
  /** Empty for anything that is not a choice question. */
  choices: string[];
  /** Whether the question offers a free-text "other" option. */
  allowOther: boolean;
}

export interface FormDefinition {
  /** Number of sections. A form with no section breaks still has one page. */
  pageCount: number;
  questions: FormQuestion[];
}

function asArray(value: unknown): RawArray | null {
  return Array.isArray(value) ? value : null;
}

/**
 * Choice options look like `[value, null, null, null, isOther]`. Google spells "Другое" as an
 * empty-valued option carrying that last flag, so it is a capability of the question rather than
 * one of its answers.
 */
function readChoices(rawOptions: unknown): { choices: string[]; allowOther: boolean } {
  const options = asArray(rawOptions);
  if (!options) return { choices: [], allowOther: false };

  const choices: string[] = [];
  let allowOther = false;

  for (const rawOption of options) {
    const option = asArray(rawOption);
    if (!option) continue;
    if (option[4] === 1) {
      allowOther = true;
      continue;
    }
    if (typeof option[0] === 'string' && option[0] !== '') choices.push(option[0]);
  }

  return { choices, allowOther };
}

function extractPayload(html: string): RawArray {
  const match = html.match(/FB_PUBLIC_LOAD_DATA_ *= *(\[[\s\S]*?\]) *;? *<\/script>/);
  if (!match || !match[1]) {
    throw new Error(
      'Could not find FB_PUBLIC_LOAD_DATA_ on the page: it does not look like a Google Form.'
    );
  }

  const parsed: unknown = JSON.parse(match[1]);
  const payload = asArray(parsed);
  if (!payload) throw new Error('FB_PUBLIC_LOAD_DATA_ is not an array.');
  return payload;
}

export function parseFormDefinition(html: string): FormDefinition {
  const payload = extractPayload(html);
  const body = asArray(payload[1]);
  const items = body ? asArray(body[1]) : null;
  if (!items) return { pageCount: 1, questions: [] };

  const questions: FormQuestion[] = [];
  let pageCount = 1;

  for (const rawItem of items) {
    const item = asArray(rawItem);
    if (!item) continue;
    if (item[3] === PAGE_BREAK_TYPE) {
      pageCount++;
      continue;
    }

    const label = typeof item[1] === 'string' ? item[1].trim() : '';
    const type = typeof item[3] === 'number' ? (QUESTION_TYPE_BY_CODE[item[3]] ?? 'text') : 'text';
    const fields = asArray(item[4]);
    if (!fields) continue;

    for (const rawField of fields) {
      const field = asArray(rawField);
      const entryId = field ? field[0] : null;
      if (!field || (typeof entryId !== 'number' && typeof entryId !== 'string')) continue;

      const { choices, allowOther } = readChoices(field[1]);
      questions.push({
        entryId: String(entryId),
        label,
        type,
        required: field[2] === 1,
        choices,
        allowOther,
      });
    }
  }

  return { pageCount, questions };
}
