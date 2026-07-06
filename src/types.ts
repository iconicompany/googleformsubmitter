export interface FormFieldMapping {
  label: string;
  type: 'text' | 'paragraph' | 'choice' | 'date' | 'file';
  allowOther?: boolean;
  options?: {
    choices?: string[];
    allowOther?: boolean;
  };
}

export type FormSchemaMapping = Record<string, FormFieldMapping>;

export interface SubmissionResult {
  success: boolean;
  statusCode: number;
  message?: string;
  fieldsSubmitted: Record<string, string>;
}
