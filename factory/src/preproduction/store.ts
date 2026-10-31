import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {PreproductionError} from '../errors';
import {resolveProjectRelativePath} from '../workspace/guard';
import {assertSafePath, ensureSafeDirectory, type WriteBoundary} from '../workspace/writeBoundary';

export const PREPRODUCTION_DIR = 'preproduction';

export const PREPRODUCTION_PATHS = {
  annotations: `${PREPRODUCTION_DIR}/annotations.json`,
  brief: `${PREPRODUCTION_DIR}/creative-brief.json`,
  beatGrid: `${PREPRODUCTION_DIR}/beat-grid.json`,
  approvedBeatGrid: `${PREPRODUCTION_DIR}/approved-beat-grid.json`,
  plan: `${PREPRODUCTION_DIR}/director-plan.json`,
  storyboard: `${PREPRODUCTION_DIR}/storyboard.json`,
  assetRequirements: `${PREPRODUCTION_DIR}/asset-requirements.json`,
  candidate: `${PREPRODUCTION_DIR}/project-candidate.json`,
  compileReport: `${PREPRODUCTION_DIR}/compile-report.json`,
  missingAssets: `${PREPRODUCTION_DIR}/missing-assets.json`,
  lyricsLrc: `${PREPRODUCTION_DIR}/lyrics.lrc`,
  lyricsJson: `${PREPRODUCTION_DIR}/lyrics.json`,
  revisions: `${PREPRODUCTION_DIR}/revisions`,
} as const;

const decodeUtf8 = (bytes: Buffer, label: string): string => {
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    throw new PreproductionError(`${label} is not valid UTF-8`);
  }
};

export const readProjectText = (
  projectDir: string,
  relativePath: string,
  options: {engineRoot?: string} = {},
): string => {
  const absolute = resolveProjectRelativePath(projectDir, relativePath, {
    engineRoot: options.engineRoot,
  });
  try {
    return decodeUtf8(readFileSync(absolute), relativePath);
  } catch (error) {
    if (error instanceof PreproductionError) throw error;
    throw new PreproductionError(
      `Unable to read ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const readProjectJson = <T>(
  projectDir: string,
  relativePath: string,
  options: {engineRoot?: string} = {},
): T => {
  const text = readProjectText(projectDir, relativePath, options).replace(/^\uFEFF/, '');
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new PreproductionError(
      `Invalid JSON in ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const readOptionalProjectText = (
  projectDir: string,
  relativePath: string,
  options: {engineRoot?: string} = {},
): string | null => {
  const absolute = resolveProjectRelativePath(projectDir, relativePath, {
    engineRoot: options.engineRoot,
    mustExist: false,
  });
  if (!existsSync(absolute)) return null;
  return readProjectText(projectDir, relativePath, options);
};

export const readOptionalProjectJson = <T>(
  projectDir: string,
  relativePath: string,
  options: {engineRoot?: string} = {},
): T | null => {
  const text = readOptionalProjectText(projectDir, relativePath, options);
  if (text === null) return null;
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '')) as T;
  } catch (error) {
    throw new PreproductionError(
      `Invalid JSON in ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const writeProjectJson = (
  boundary: WriteBoundary,
  relativePath: string,
  value: unknown,
): string => {
  const target = path.join(boundary.projectRoot, relativePath);
  ensureSafeDirectory(boundary, path.dirname(target), 'project');
  assertSafePath(boundary, target, {expect: 'file', subtree: 'project'});
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  return target;
};

export const revisionPath = (
  kind: 'director-plan' | 'storyboard' | 'approved-beat-grid',
  revision: number,
): string =>
  `${PREPRODUCTION_PATHS.revisions}/${kind}-r${String(revision).padStart(3, '0')}.json`;