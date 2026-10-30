import {copyFileSync} from 'node:fs';
import path from 'node:path';
import {MediaError} from '../errors';
import type {LoadedProject} from '../config/types';
import {sha256File} from './hash';
import {
  assertSafePath,
  createProjectWriteBoundary,
  ensureSafeDirectory,
  safeRecreateDirectory,
  type WriteBoundary,
} from '../workspace/writeBoundary';

export type StagedMedia = {
  publicDir: string;
  publicAssets: Record<string, string>;
  audioPublicPath?: string;
};

const toPublicPath = (relativePath: string): string => relativePath.replace(/\\/g, '/');

/**
 * Copies only approved, manifest-listed assets into the project's own cache.
 * The cache directory is validated and recreated through the central write
 * boundary; no source file or other project cache is touched.
 */
export const stageProjectMedia = (
  project: LoadedProject,
  options: {engineRoot?: string; boundary?: WriteBoundary} = {},
): StagedMedia => {
  const boundary =
    options.boundary ?? createProjectWriteBoundary(project, {engineRoot: options.engineRoot});
  const publicDir = path.join(boundary.cacheRoot, 'render-public');
  const safePublicDir = safeRecreateDirectory(boundary, publicDir);

  const publicAssets: Record<string, string> = {};
  for (const asset of project.assets) {
    if (asset.approval !== 'approved' || !asset.absolutePath) continue;
    if (sha256File(asset.absolutePath) !== asset.sha256) {
      throw new MediaError(`Approved source hash mismatch for ${asset.id}`);
    }

    const relative = toPublicPath(asset.path);
    const target = path.resolve(safePublicDir, relative);
    if (!target.startsWith(safePublicDir + path.sep)) {
      throw new MediaError(`Asset path escapes staging: ${asset.path}`);
    }
    ensureSafeDirectory(boundary, path.dirname(target), 'cache');
    assertSafePath(boundary, target, {expect: 'file', subtree: 'cache'});
    copyFileSync(asset.absolutePath, target);
    if (sha256File(target) !== asset.sha256) {
      throw new MediaError(`Staged asset hash mismatch for ${asset.id}`);
    }
    publicAssets[asset.id] = relative;
  }

  if (sha256File(project.audioPath) !== project.config.audio.sha256) {
    throw new MediaError('Approved source audio hash mismatch');
  }
  const audioRelative = `source/audio/${path.basename(project.audioPath)}`;
  const audioTarget = path.resolve(safePublicDir, audioRelative);
  if (!audioTarget.startsWith(safePublicDir + path.sep)) {
    throw new MediaError('Audio path escapes staging');
  }
  ensureSafeDirectory(boundary, path.dirname(audioTarget), 'cache');
  assertSafePath(boundary, audioTarget, {expect: 'file', subtree: 'cache'});
  copyFileSync(project.audioPath, audioTarget);
  if (sha256File(audioTarget) !== project.config.audio.sha256) {
    throw new MediaError('Staged audio hash mismatch');
  }

  return {
    publicDir: safePublicDir,
    publicAssets,
    audioPublicPath: toPublicPath(audioRelative),
  };
};
