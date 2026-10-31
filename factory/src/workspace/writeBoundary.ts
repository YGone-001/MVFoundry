import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import type {LoadedProject} from '../config/types';
import {WriteBoundaryError} from '../errors';
import {DEFAULT_ENGINE_ROOT, isInside} from './guard';

export type WriteSubtree = 'project' | 'cache' | 'renders';

export type WriteBoundary = {
  projectRoot: string;
  cacheRoot: string;
  rendersRoot: string;
  engineRoot: string;
  sourcePaths: readonly string[];
};

export type CreateWriteBoundaryOptions = {
  projectDir: string;
  engineRoot?: string;
  sourcePaths?: readonly string[];
};

const normalized = (value: string): string =>
  process.platform === 'win32' ? value.toLowerCase() : value;

const samePath = (a: string, b: string): boolean =>
  normalized(path.resolve(a)) === normalized(path.resolve(b));

const fail = (message: string): never => {
  throw new WriteBoundaryError(message);
};

const existingChildDirectory = (root: string, name: string): string => {
  const candidate = path.join(root, name);
  if (!existsSync(candidate)) return candidate;
  const stat = lstatSync(candidate);
  if (stat.isSymbolicLink()) fail(`Linked workspace component is forbidden: ${candidate}`);
  if (!stat.isDirectory()) fail(`Workspace component is not a directory: ${candidate}`);
  const real = realpathSync(candidate);
  if (!isInside(root, real)) fail(`Workspace component escapes the project: ${candidate}`);
  return real;
};

export const createWriteBoundary = (options: CreateWriteBoundaryOptions): WriteBoundary => {
  if (!existsSync(options.projectDir)) fail(`Project directory does not exist: ${options.projectDir}`);
  const projectRoot = realpathSync(options.projectDir);
  if (!statSync(projectRoot).isDirectory()) fail(`Project root is not a directory: ${projectRoot}`);
  const engineRoot = realpathSync(options.engineRoot ?? DEFAULT_ENGINE_ROOT);
  if (isInside(engineRoot, projectRoot) || isInside(projectRoot, engineRoot)) {
    fail('Project root and engine repository must not overlap');
  }

  const cacheRoot = existingChildDirectory(projectRoot, 'cache');
  const rendersRoot = existingChildDirectory(projectRoot, 'renders');
  const sourcePaths = (options.sourcePaths ?? []).map((source) => {
    if (!existsSync(source)) fail(`Protected source does not exist: ${source}`);
    const real = realpathSync(source);
    if (!isInside(projectRoot, real)) fail(`Protected source is outside the project: ${source}`);
    return real;
  });

  return {projectRoot, cacheRoot, rendersRoot, engineRoot, sourcePaths};
};

export const createProjectWriteBoundary = (
  project: LoadedProject,
  options: {engineRoot?: string} = {},
): WriteBoundary =>
  createWriteBoundary({
    projectDir: project.projectDir,
    engineRoot: options.engineRoot,
    sourcePaths: [
      project.audioPath,
      ...project.assets
        .filter((asset) => asset.approval === 'approved' && asset.absolutePath)
        .map((asset) => asset.absolutePath as string),
      ...project.sceneModules.map((module) => module.absolutePath),
    ],
  });

const validateAncestorsAndTarget = (
  boundary: WriteBoundary,
  absolute: string,
  expect: 'file' | 'dir' | 'any',
): void => {
  const relative = path.relative(boundary.projectRoot, absolute);
  if (path.isAbsolute(relative)) fail(`Path is outside the project: ${absolute}`);
  const segments = relative.split(path.sep).filter((segment) => segment && segment !== '.');
  let current = boundary.projectRoot;

  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    const isLast = index === segments.length - 1;
    if (!existsSync(current)) break;

    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) fail(`Links are forbidden at write path: ${current}`);
    const real = realpathSync(current);
    if (!isInside(boundary.projectRoot, real)) fail(`Write path escapes the project: ${current}`);
    if (!samePath(real, current)) fail(`Linked directory component is forbidden: ${current}`);
    if (!isLast && !stat.isDirectory()) fail(`Ancestor is not a directory: ${current}`);
    if (isLast) {
      if (expect === 'file' && !stat.isFile()) fail(`Destination is not a regular file: ${current}`);
      if (expect === 'dir' && !stat.isDirectory()) fail(`Destination is not a directory: ${current}`);
    }
  }
};

/** Validate an absolute destination or a path relative to the project root. */
export const assertSafePath = (
  boundary: WriteBoundary,
  target: string,
  options: {
    expect?: 'file' | 'dir' | 'any';
    subtree?: WriteSubtree;
    allowProjectRoot?: boolean;
  } = {},
): string => {
  if (typeof target !== 'string' || target.includes('\0') || target.trim() === '') {
    fail('Write path must be a non-empty string without NUL bytes');
  }
  const absolute = path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(boundary.projectRoot, target);
  if (samePath(absolute, boundary.projectRoot) && !options.allowProjectRoot) {
    fail('Writing to the project root itself is forbidden');
  }
  if (!isInside(boundary.projectRoot, absolute)) {
    fail(`Write path is outside the authorized project: ${absolute}`);
  }
  if (isInside(boundary.engineRoot, absolute)) {
    fail(`Write path is inside the engine repository: ${absolute}`);
  }

  const subtree = options.subtree ?? 'project';
  if (subtree === 'cache' && !isInside(boundary.cacheRoot, absolute)) {
    fail(`Write path is outside the project cache: ${absolute}`);
  }
  if (subtree === 'renders' && !isInside(boundary.rendersRoot, absolute)) {
    fail(`Write path is outside the project renders directory: ${absolute}`);
  }

  validateAncestorsAndTarget(boundary, absolute, options.expect ?? 'any');

  const targetReal = existsSync(absolute) ? realpathSync(absolute) : absolute;
  for (const source of boundary.sourcePaths) {
    if (samePath(absolute, source) || samePath(targetReal, source)) {
      fail(`Refusing to overwrite a protected project source: ${source}`);
    }
  }
  return absolute;
};

export const ensureSafeDirectory = (
  boundary: WriteBoundary,
  target: string,
  subtree: WriteSubtree = 'project',
): string => {
  const checked = assertSafePath(boundary, target, {expect: 'dir', subtree});
  if (!existsSync(checked)) mkdirSync(checked, {recursive: true});
  const real = realpathSync(checked);
  if (!isInside(boundary.projectRoot, real)) fail(`Directory escapes after creation: ${checked}`);
  if (subtree === 'cache' && !isInside(boundary.cacheRoot, real)) {
    fail(`Cache directory escapes after creation: ${checked}`);
  }
  if (subtree === 'renders' && !isInside(boundary.rendersRoot, real)) {
    fail(`Renders directory escapes after creation: ${checked}`);
  }
  return real;
};

const assertNoLinksInTree = (boundary: WriteBoundary, directory: string): void => {
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, {withFileTypes: true})) {
      const child = path.join(current, entry.name);
      const stat = lstatSync(child);
      if (stat.isSymbolicLink()) fail(`Refusing to delete linked entry: ${child}`);
      const real = realpathSync(child);
      if (!isInside(boundary.cacheRoot, real)) fail(`Cache entry escapes the cache root: ${child}`);
      if (stat.isDirectory()) visit(child);
    }
  };
  visit(directory);
};

/**
 * Delete and recreate an engine-owned cache directory. The target must be a
 * strict descendant of <project>/cache; the cache root and project root cannot
 * be deleted. Existing links anywhere under the target are rejected.
 */
export const safeRecreateDirectory = (
  boundary: WriteBoundary,
  target: string,
): string => {
  const absolute = path.resolve(target);
  if (!isInside(boundary.cacheRoot, absolute)) {
    fail(`Cleanup target is not inside the project cache: ${absolute}`);
  }
  if (samePath(absolute, boundary.cacheRoot)) {
    fail('Refusing to delete the project cache root');
  }
  assertSafePath(boundary, absolute, {expect: 'dir', subtree: 'cache'});
  if (existsSync(absolute)) {
    assertNoLinksInTree(boundary, absolute);
    rmSync(absolute, {recursive: true, force: true});
  }
  mkdirSync(absolute, {recursive: true});
  const real = realpathSync(absolute);
  if (!isInside(boundary.cacheRoot, real)) fail(`Recreated cache escapes: ${absolute}`);
  return real;
};

export type RenderOutputOptions = {
  mode: 'video' | 'still';
  projectId: string;
  frame?: number;
  requested?: string;
};

/**
 * Output policy: defaults under <project>/renders; explicit overrides are
 * a single filename (relative) or an absolute direct child of renders.
 */
export const resolveRenderOutputPath = (
  boundary: WriteBoundary,
  options: RenderOutputOptions,
): string => {
  const defaultName =
    options.mode === 'still'
      ? `${options.projectId}-still-${String(options.frame ?? 0).padStart(4, '0')}.png`
      : `${options.projectId}-render.mp4`;

  let target: string;
  if (options.requested === undefined) {
    target = path.join(boundary.rendersRoot, defaultName);
  } else {
    const requested = options.requested.trim();
    if (!requested || requested.includes('\0')) fail('Output filename is empty or invalid');
    if (path.isAbsolute(requested)) {
      target = path.resolve(requested);
    } else {
      if (requested === '.' || requested === '..' || requested.includes('/') || requested.includes('\\')) {
        fail('Relative --out must be a single filename directly inside renders/');
      }
      target = path.join(boundary.rendersRoot, requested);
    }
    if (!samePath(path.dirname(target), boundary.rendersRoot)) {
      fail('Explicit --out must be a direct child of the project renders directory');
    }
  }

  assertSafePath(boundary, target, {expect: 'file', subtree: 'renders'});
  ensureSafeDirectory(boundary, boundary.rendersRoot, 'renders');
  return assertSafePath(boundary, target, {expect: 'file', subtree: 'renders'});
};
