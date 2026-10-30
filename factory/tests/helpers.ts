import {cpSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
export const EXAMPLES = path.resolve(__dirname, '..', '..', 'examples', 'projects');

export const makeWorkspace = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), 'mv-factory-test-'));
  cpSync(EXAMPLES, root, {recursive: true});
  return root;
};

export const readText = (relativePath: string): string =>
  readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

export const readProjectJson = (workspaceRoot: string, projectId: string): Record<string, any> =>
  JSON.parse(
    readFileSync(path.join(workspaceRoot, projectId, 'project.json'), 'utf8'),
  ) as Record<string, any>;

export const cloneProject = (
  workspaceRoot: string,
  sourceId: string,
  targetId: string,
  mutate?: (config: Record<string, any>) => void,
): string => {
  const target = path.join(workspaceRoot, targetId);
  cpSync(path.join(workspaceRoot, sourceId), target, {recursive: true});
  const config = readProjectJson(workspaceRoot, targetId);
  config.projectId = targetId;
  if (mutate) mutate(config);
  writeFileSync(path.join(target, 'project.json'), JSON.stringify(config, null, 2));
  return target;
};
