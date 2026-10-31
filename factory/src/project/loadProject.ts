import {readFileSync, readdirSync, existsSync} from 'node:fs';
import path from 'node:path';
import {ConfigValidationError, MediaError, WorkspaceError} from '../errors';
import {durationFramesFromSeconds} from '../config/duration';
import type {LoadedAsset, LoadedProject, ProjectConfig} from '../config/types';
import {validateProjectConfig} from '../config/validate';
import {sha256File} from '../media/hash';
import {probeAudio} from '../media/audioProbe';
import {probeVideo} from '../media/videoProbe';
import {probeLayerPng} from '../media/pngProbe';
import {assertMediaTimelines} from '../media/mediaTimeline';
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
  const audioMetadata = probeAudio(
    audioPath,
    config.audio.assetId ?? 'master',
    config.audio.format,
  );
  const durationTolerance =
    config.audio.format === 'wav-pcm'
      ? 0.02
      : Math.max(0.05, 1 / config.output.fps);
  if (Math.abs(audioMetadata.decodedDurationSeconds - config.audio.durationSeconds) > durationTolerance) {
    throw new MediaError(
      `Audio duration mismatch: config ${config.audio.durationSeconds}s, ${config.audio.format} decoded ${audioMetadata.decodedDurationSeconds}s`,
    );
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
    const loaded: LoadedAsset = {...asset, absolutePath, hashVerified: true};
    if (asset.kind === 'video') {
      loaded.videoMetadata = probeVideo(absolutePath, asset.id);
    }
    if (asset.kind === 'layer') {
      probeLayerPng(absolutePath, asset.id);
    }
    if (asset.kind === 'audio-reference') {
      loaded.audioMetadata =
        asset.id === config.audio.assetId && absolutePath === audioPath
          ? audioMetadata
          : probeAudio(absolutePath, asset.id);
    }
    return loaded;
  });

  const shots = resolveShots(config.chapters);
  assertShotCoverage(shots, durationInFrames);
  assertMediaTimelines(config, assets, config.output.fps);
  const sampleTolerance = 1 / config.audio.mixSampleRate + 1e-9;
  for (const track of config.audioTracks) {
    const asset = assets.find((candidate) => candidate.id === track.assetId);
    const metadata = asset?.audioMetadata;
    if (!asset || !asset.absolutePath || !metadata) {
      throw new MediaError(
        `Audio track ${track.id} references unavailable asset ${track.assetId}`,
      );
    }
    const sourceEnd = track.sourceStartSeconds + track.durationFrames / config.output.fps;
    if (
      track.sourceStartSeconds >= metadata.decodedDurationSeconds ||
      sourceEnd > metadata.decodedDurationSeconds + sampleTolerance
    ) {
      throw new MediaError(
        `Audio track ${track.id} range ${track.sourceStartSeconds}s-${sourceEnd}s exceeds the decoded source duration ${metadata.decodedDurationSeconds}s`,
      );
    }
  }

  const videoMetadata = Object.fromEntries(
    assets
      .filter((asset) => asset.videoMetadata)
      .map((asset) => [asset.id, asset.videoMetadata]),
  );

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
    audioMetadata,
    audioTracks: config.audioTracks,
    renderProject: toRenderProject(config, durationInFrames, videoMetadata),
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
