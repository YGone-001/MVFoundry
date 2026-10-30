import {SceneRenderError} from '../../errors';
import type {RenderProjectSnapshot} from '../../config/types';
import type {SceneRenderer} from '../types';

const placeholder = (kind: 'video' | 'hybrid'): SceneRenderer => ({
  kind,
  canvasSize: (project: RenderProjectSnapshot) => ({
    width: project.output.width,
    height: project.output.height,
  }),
  samplingFps: (project) => project.output.fps,
  render: () => {
    throw new SceneRenderError(
      `Renderer "${kind}" is a typed P0 placeholder; no media or hybrid rendering is implemented`,
    );
  },
});

export const videoRenderer = placeholder('video');
export const hybridRenderer = placeholder('hybrid');
