import {createHash} from 'node:crypto';
import type {ProjectConfig} from '../config/types';

/**
 * A render report describes one exact input state. When the style, the media
 * route, an approved asset hash, a scene module hash or the output profile
 * changes, older evidence no longer describes the current project and must not
 * be presented as current.
 */
export type RenderEvidenceFingerprint = {
  schemaVersion: 1;
  projectId: string;
  style: {id: string; theme?: string} | null;
  renderers: string[];
  mediaKinds: string[];
  assets: Array<{id: string; kind: string; sha256: string; approval: string}>;
  sceneModules: Array<{id: string; sha256: string}>;
  output: {width: number; height: number; fps: number; durationInFrames: number};
  hash: string;
};

const sha256Json = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const renderEvidenceFingerprint = (
  config: ProjectConfig,
  durationInFrames: number,
): RenderEvidenceFingerprint => {
  const style = config.visual.style
    ? {
        id: config.visual.style.id,
        ...(config.visual.style.theme ? {theme: config.visual.style.theme} : {}),
      }
    : null;
  const renderers = [
    ...new Set(config.chapters.flatMap((chapter) => chapter.shots.map((shot) => shot.renderer))),
  ].sort();
  const mediaKinds = [
    ...new Set(
      config.chapters.flatMap((chapter) =>
        chapter.shots.flatMap((shot) => (shot.media ? [shot.media.kind] : [])),
      ),
    ),
  ].sort();
  const assets = [...config.assets]
    .map((asset) => ({
      id: asset.id,
      kind: asset.kind,
      sha256: asset.sha256,
      approval: asset.approval,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const sceneModules = [...config.sceneModules]
    .map((module) => ({id: module.id, sha256: module.sha256}))
    .sort((left, right) => left.id.localeCompare(right.id));
  const payload = {
    schemaVersion: 1 as const,
    projectId: config.projectId,
    style,
    renderers,
    mediaKinds,
    assets,
    sceneModules,
    output: {
      width: config.output.width,
      height: config.output.height,
      fps: config.output.fps,
      durationInFrames,
    },
  };
  return {...payload, hash: sha256Json(payload)};
};

export const isRenderEvidenceCurrent = (
  stored: {hash?: unknown} | null | undefined,
  current: RenderEvidenceFingerprint,
): boolean =>
  Boolean(stored) && typeof stored?.hash === 'string' && stored.hash === current.hash;
