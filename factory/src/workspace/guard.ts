import {existsSync, realpathSync, statSync} from 'node:fs';
import path from 'node:path';
import {WorkspaceError} from '../errors';

const findEngineRoot = (start: string): string => {
  let current = path.resolve(start);
  while (path.dirname(current) !== current) {
    if (
      existsSync(path.join(current, 'package.json')) &&
      existsSync(path.join(current, 'factory'))
    ) {
      return current;
    }
    current = path.dirname(current);
  }
  return path.resolve(start, '..');
};

// Works from factory/src/workspace and factory/dist/src/workspace alike.
export const DEFAULT_ENGINE_ROOT = findEngineRoot(__dirname);

export const isInside = (parent: string, child: string): boolean => {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (relative === '') return true;
  if (path.isAbsolute(relative)) return false;
  return !relative.startsWith(`..${path.sep}`) && relative !== '..';
};

const assertNoOverlap = (engineRoot: string, workspaceRoot: string): void => {
  if (isInside(engineRoot, workspaceRoot)) {
    throw new WorkspaceError('Workspace root must be outside the engine repository');
  }
  if (isInside(workspaceRoot, engineRoot)) {
    throw new WorkspaceError(
      'Workspace root must not contain the engine repository; use a dedicated sibling directory',
    );
  }
};

export const canonicalExistingDirectory = (value: string, label: string): string => {
  const resolved = path.resolve(value);
  if (!existsSync(resolved)) {
    throw new WorkspaceError(`${label} does not exist: ${resolved}`);
  }
  const real = realpathSync(resolved);
  if (!statSync(real).isDirectory()) {
    throw new WorkspaceError(`${label} is not a directory: ${real}`);
  }
  return real;
};

export const getWorkspaceRoot = (options: {
  explicitRoot?: string;
  engineRoot?: string;
} = {}): string => {
  const raw = options.explicitRoot ?? process.env.MV_WORKSPACE_ROOT;
  if (!raw || !raw.trim()) {
    throw new WorkspaceError(
      'MV_WORKSPACE_ROOT is not configured; refusing to fall back into the engine repository',
    );
  }
  const engineRoot = realpathSync(options.engineRoot ?? DEFAULT_ENGINE_ROOT);
  const workspaceRoot = canonicalExistingDirectory(raw, 'Workspace root');
  assertNoOverlap(engineRoot, workspaceRoot);
  return workspaceRoot;
};

const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

export const assertProjectId = (projectId: string): void => {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new WorkspaceError(
      `Invalid project id "${projectId}"; use lowercase letters, digits and hyphens (3-64 chars)`,
    );
  }
  if (projectId.includes('..') || projectId.includes('/') || projectId.includes('\\')) {
    throw new WorkspaceError(`Project id must not contain path separators: ${projectId}`);
  }
};

export const resolveProjectDir = (options: {
  workspaceRoot: string;
  projectId: string;
  engineRoot?: string;
}): string => {
  assertProjectId(options.projectId);
  const engineRoot = realpathSync(options.engineRoot ?? DEFAULT_ENGINE_ROOT);
  const workspaceRoot = canonicalExistingDirectory(options.workspaceRoot, 'Workspace root');
  const candidate = path.resolve(workspaceRoot, options.projectId);
  if (!existsSync(candidate)) {
    throw new WorkspaceError(`Project does not exist: ${options.projectId}`);
  }
  const real = realpathSync(candidate);
  if (!isInside(workspaceRoot, real)) {
    throw new WorkspaceError(`Project escapes the workspace root: ${options.projectId}`);
  }
  if (isInside(engineRoot, real)) {
    throw new WorkspaceError(`Project is inside the engine repository: ${options.projectId}`);
  }
  if (!statSync(real).isDirectory()) {
    throw new WorkspaceError(`Project is not a directory: ${options.projectId}`);
  }
  if (!existsSync(path.join(real, 'project.json'))) {
    throw new WorkspaceError(`Missing project.json in ${options.projectId}`);
  }
  return real;
};

/**
 * Resolve a manifest-declared relative path inside a project. Existing paths
 * are canonicalized so junctions/symlinks cannot escape the project.
 */
export const resolveProjectRelativePath = (
  projectDir: string,
  relativePath: string,
  options: {mustExist?: boolean; engineRoot?: string} = {},
): string => {
  if (!relativePath || relativePath.trim() === '') {
    throw new WorkspaceError('Relative path must not be empty');
  }
  if (path.isAbsolute(relativePath) || path.parse(relativePath).root !== '') {
    throw new WorkspaceError(`Absolute paths are forbidden: ${relativePath}`);
  }
  const normalized = path.normalize(relativePath);
  const segments = normalized.split(/[\\/]+/);
  if (segments.includes('..')) {
    throw new WorkspaceError(`Parent traversal is forbidden: ${relativePath}`);
  }

  const projectRoot = realpathSync(projectDir);
  const candidate = path.resolve(projectRoot, normalized);
  if (!isInside(projectRoot, candidate)) {
    throw new WorkspaceError(`Path escapes the project root: ${relativePath}`);
  }
  if (options.mustExist ?? true) {
    if (!existsSync(candidate)) {
      throw new WorkspaceError(`Path does not exist: ${relativePath}`);
    }
    const real = realpathSync(candidate);
    if (!isInside(projectRoot, real)) {
      throw new WorkspaceError(`Path escapes the project root via a link: ${relativePath}`);
    }
    const engineRoot = realpathSync(options.engineRoot ?? DEFAULT_ENGINE_ROOT);
    if (isInside(engineRoot, real)) {
      throw new WorkspaceError(`Path points into the engine repository: ${relativePath}`);
    }
    return real;
  }
  return candidate;
};
