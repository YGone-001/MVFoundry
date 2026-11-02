import {readFileSync, statSync} from 'node:fs';
import {ConfigValidationError} from '../errors';

/**
 * Project metadata supplied through an explicitly selected UTF-8 JSON document.
 * This exists because command-line argument encoding is owned by the parent
 * shell: a correctly formed JSON file removes that dependency for song titles,
 * artist names, provenance and rights statements.
 */
export const PROJECT_METADATA_MAX_BYTES = 64 * 1024;
const MAX_FIELD_LENGTH = 4000;

const FIELDS = ['title', 'artist', 'source', 'rights', 'styleProfile'] as const;
export type ProjectMetadataField = (typeof FIELDS)[number];
export type ProjectMetadata = Partial<Record<ProjectMetadataField, string>>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function fail(message: string, file: string): never {
  throw new ConfigValidationError(`Metadata file ${file}: ${message}`);
}

const validateField = (field: string, value: unknown, file: string): string => {
  if (typeof value !== 'string') fail(`"${field}" must be a string`, file);
  if (value.length === 0) fail(`"${field}" must not be empty`, file);
  if (value.length > MAX_FIELD_LENGTH) {
    fail(`"${field}" is longer than ${MAX_FIELD_LENGTH} characters`, file);
  }
  if (value.trim().length === 0) fail(`"${field}" must not be only whitespace`, file);
  // C0 control characters cannot be represented meaningfully in project.json
  // and usually mean a broken encoder or a binary file was supplied.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    fail(`"${field}" contains control characters`, file);
  }
  return value;
};

/**
 * Parses an explicitly selected metadata document. Invalid UTF-8, malformed
 * JSON, unknown keys and non-string values are refused rather than repaired.
 */
export const parseProjectMetadataFile = (file: string): ProjectMetadata => {
  let size: number;
  try {
    size = statSync(file).size;
  } catch (error) {
    fail(`cannot be read (${error instanceof Error ? error.message : String(error)})`, file);
  }
  if (size === 0) fail('is empty', file);
  if (size > PROJECT_METADATA_MAX_BYTES) {
    fail(`is ${size} bytes; the supported limit is ${PROJECT_METADATA_MAX_BYTES}`, file);
  }
  const bytes = readFileSync(file);
  let text: string;
  try {
    text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: false}).decode(bytes);
  } catch {
    fail('is not valid UTF-8; re-encode it as UTF-8 without lossy conversion', file);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    fail(`is not valid JSON (${error instanceof Error ? error.message : String(error)})`, file);
  }
  if (!isPlainObject(parsed)) fail('must contain a JSON object', file);
  const result: ProjectMetadata = {};
  const keys = Object.keys(parsed).sort();
  for (const key of keys) {
    if (!(FIELDS as readonly string[]).includes(key)) {
      fail(`contains unsupported field "${key}"; allowed fields are ${FIELDS.join(', ')}`, file);
    }
    const field = key as ProjectMetadataField;
    result[field] = validateField(field, parsed[key], file);
  }
  if (keys.length === 0) fail('declares no metadata fields', file);
  return result;
};

/**
 * Combines command-line values with the metadata document. A field declared
 * twice with different values is ambiguous and refused; identical duplicates
 * are accepted because they cannot change the stored project.
 */
export const mergeProjectMetadata = (
  cli: ProjectMetadata,
  file: ProjectMetadata | null,
  filePath: string | null,
): ProjectMetadata => {
  const merged: ProjectMetadata = {};
  for (const field of FIELDS) {
    const fromCli = cli[field];
    const fromFile = file?.[field];
    if (fromCli !== undefined && fromFile !== undefined && fromCli !== fromFile) {
      throw new ConfigValidationError(
        `Metadata field "${field}" is declared twice with different values (command line and ${
          filePath ?? 'the metadata file'
        }); keep exactly one declaration`,
      );
    }
    const value = fromCli ?? fromFile;
    if (value !== undefined) merged[field] = value;
  }
  return merged;
};