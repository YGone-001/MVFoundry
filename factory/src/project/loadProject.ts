import {readFileSync, readdirSync, existsSync} from 'node:fs';
import path from 'node:path';
import {ConfigValidationError, MediaError, WorkspaceError} from '../errors';
import {durationFramesFromSeconds} from '../config/duration';
import type {LoadedAsset, LoadedProject, ProjectConfig} from '../config/types';
import {validateProjectConfig} from '../config/validate';
import {sha256File} from '../media/hash';
import {readWavMetadata} from '../media/wav';
import {resolveShots, assertShotCoverage} from '../timeline/resolver';
import {DEFAULT_SCENE_REGISTRY} from '../scenes/registry';
import type {SceneRegistry} from '../scenes/types';
import {toRenderProject} from '../project/toRenderProject';
import {loadProjectSceneModules} from '../project/sceneModules';
import {
  assertProjectId,
  getWorkspaceRoot,
  resolveProjectDir,
  resolveProjectRelativePath,
} from '../workspace/guard';

export type LoadProjectOptions = {
  workspaceRoot?: string;
  engineRoot?: string;
  registry?: SceneRegistry;
};

const readProjectJson = (projectDir: string): unknown => {
  try {
    return JSON.parse(readFileSync(path.join(projectDir, 'project.json'), 'utf8')) as unknown;
  } catch (error) {
    throw new ConfigValidationError(
      `Unable to read project.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

export const loadProject = (
  projectId: string,
  options: LoadProjectOptions = {},
): LoadedProject => {
  const registry = options.registry ?? DEFAULT_SCENE_REGISTRY;
  const workspaceRoot = getWorkspaceRoot({
    explicitRoot: options.workspaceRoot,
    engineRoot: options.engineRoot,
  });
  const projectDir = resolveProjectDir({
    workspaceRoot,
    projectId,
    engineRoot: options.engineRoot,
  });
  if (path.basename(projectDir) !== projectId) {
    throw new WorkspaceError(
      `projectId "${projectId}" must match the workspace folder name "${path.basename(projectDir)}"`,
    );
  }

  const config = validateProjectConfig(readProjectJson(projectDir), {
    rendererKinds: new Set(registry.kinds()),
  });
  if (config.projectId !== projectId) {
    throw new ConfigValidationError(
      `project.json declares "${config.projectId}" but was loaded as "${projectId}"`,
    );
  }

  const sceneModules = loadProjectSceneModules(projectDir, config.sceneModules, {
    engineRoot: options.engineRoot,
  });

  const audioPath = resolveProjectRelativePath(projectDir, config.audio.path, {
    engineRoot: options.engineRoot,
  });
  const audioHash = sha256File(audioPath);
  if (audioHash !== config.audio.sha256) {
    throw new MediaError(
      `Audio SHA256 mismatch for ${config.audio.path}: expected ${config.audio.sha256}, received ${audioHash}`,
    );
  }
  if (config.audio.format === 'wav-pcm') {
    const wav = readWavMetadata(audioPath);
    if (Math.abs(wav.durationSeconds - config.audio.durationSeconds) > 0.02) {
      throw new MediaError(
        `Audio duration mismatch: config ${config.audio.durationSeconds}s, WAV ${wav.durationSeconds}s`,
      );
    }
  }
  const durationInFrames = durationFramesFromSeconds(
    config.audio.durationSeconds,
    config.output.fps,
    config.audio.durationPolicy,
  );
  if (config.output.durationInFrames !== undefined && config.output.durationInFrames !== durationInFrames) {
    throw new ConfigValidationError(
      `output.durationInFrames does not match the audio-derived duration ${durationInFrames}`,
    );
  }

  const assets: LoadedAsset[] = config.assets.map((asset) => {
    if (asset.approval !== 'approved') {
      return {...asset, absolutePath: null, hashVerified: false};
    }
    const absolutePath = resolveProjectRelativePath(projectDir, asset.path, {
      engineRoot: options.engineRoot,
    });
    const hash = sha256File(absolutePath);
    if (hash !== asset.sha256) {
      throw new MediaError(
        `Asset SHA256 mismatch for ${asset.id}: expected ${asset.sha256}, received ${hash}`,
      );
    }
    return {...asset, absolutePath, hashVerified: true};
  });

  const shots = resolveShots(config.chapters);
  assertShotCoverage(shots, durationInFrames);

  return {
    config,
    workspaceRoot,
    projectDir,
    audioPath,
    audioDurationSeconds: config.audio.durationSeconds,
    durationInFrames,
    shots,
    assets,
    sceneModules,
    renderProject: toRenderProject(config, durationInFrames),
  };
};

export const listProjectIds = (options: {
  workspaceRoot?: string;
  engineRoot?: string;
} = {}): string[] => {
  const workspaceRoot = getWorkspaceRoot({
    explicitRoot: options.workspaceRoot,
    engineRoot: options.engineRoot,
  });
  return readdirSync(workspaceRoot, {withFileTypes: true})
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      try {
        assertProjectId(name);
      } catch {
        return false;
      }
      return existsSync(path.join(workspaceRoot, name, 'project.json'));
    })
    .sort();
};

export const loadAllProjects = (
  options: LoadProjectOptions = {},
): LoadedProject[] => listProjectIds(options).map((id) => loadProject(id, options));

export const describeProject = (config: ProjectConfig): string =>
  `${config.projectId}: ${config.song.title} / ${config.song.artist} / ${config.output.width}x${config.output.height} @ ${config.output.fps}fps / ${config.output.durationInFrames ?? 'derived'} frames`;
