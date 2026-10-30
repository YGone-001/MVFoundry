import {copyFileSync, mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {MediaError} from '../errors';
import type {LoadedProject} from '../config/types';
import {sha256File} from './hash';
import {DEFAULT_ENGINE_ROOT, isInside} from '../workspace/guard';

export type StagedMedia = {
  publicDir: string;
  publicAssets: Record<string, string>;
  audioPublicPath?: string;
};

const toPublicPath = (relativePath: string): string => relativePath.replace(/\\/g, '/');

/**
 * Copies only approved, manifest-listed assets into the project's own cache.
 * Remotion receives this directory as publicDir; nothing is copied into the
 * engine repository and no HTTP service is added.
 */
export const stageProjectMedia = (
  project: LoadedProject,
  options: {engineRoot?: string} = {},
): StagedMedia => {
  const engineRoot = options.engineRoot ?? DEFAULT_ENGINE_ROOT;
  const publicDir = path.join(project.projectDir, 'cache', 'render-public');
  if (!isInside(project.projectDir, publicDir)) {
    throw new MediaError('Render staging must stay inside the project workspace');
  }
  if (isInside(engineRoot, publicDir)) {
    throw new MediaError('Render staging must stay outside the engine repository');
  }

  rmSync(publicDir, {recursive: true, force: true});
  mkdirSync(publicDir, {recursive: true});

  const publicAssets: Record<string, string> = {};
  for (const asset of project.assets) {
    if (asset.approval !== 'approved' || !asset.absolutePath) continue;
    const relative = toPublicPath(asset.path);
    const target = path.resolve(publicDir, relative);
    if (!isInside(publicDir, target)) {
      throw new MediaError(`Asset path escapes staging: ${asset.path}`);
    }
    mkdirSync(path.dirname(target), {recursive: true});
    copyFileSync(asset.absolutePath, target);
    if (sha256File(target) !== asset.sha256) {
      throw new MediaError(`Staged asset hash mismatch for ${asset.id}`);
    }
    publicAssets[asset.id] = relative;
  }

  const audioRelative = `source/audio/${path.basename(project.audioPath)}`;
  const audioTarget = path.resolve(publicDir, audioRelative);
  if (!isInside(publicDir, audioTarget)) {
    throw new MediaError('Audio path escapes staging');
  }
  mkdirSync(path.dirname(audioTarget), {recursive: true});
  copyFileSync(project.audioPath, audioTarget);
  if (sha256File(audioTarget) !== project.config.audio.sha256) {
    throw new MediaError('Staged audio hash mismatch');
  }

  return {
    publicDir,
    publicAssets,
    audioPublicPath: toPublicPath(audioRelative),
  };
};
