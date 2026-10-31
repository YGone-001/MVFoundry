import type {ComponentType} from 'react';
import type {RenderProjectShot, RenderProjectSnapshot} from '../config/types';
import type {SceneFrameInfo} from '../timeline/frameClock';
import {SceneRenderError} from '../errors';

export type CanvasSize = {
  width: number;
  height: number;
};

export type SceneRenderContext = {
  project: RenderProjectSnapshot;
  shot: RenderProjectShot;
  frame: SceneFrameInfo;
  publicAssets: Record<string, string>;
};

export type CanvasSceneRenderer = {
  kind: string;
  mode?: 'canvas';
  pixelated?: boolean;
  canvasSize: (project: RenderProjectSnapshot, shot: RenderProjectShot) => CanvasSize;
  samplingFps: (project: RenderProjectSnapshot, shot: RenderProjectShot) => number;
  render: (ctx: CanvasRenderingContext2D, context: SceneRenderContext) => void;
};

export type MediaSceneRendererProps = {
  project: RenderProjectSnapshot;
  shot: RenderProjectShot;
  publicAssets: Record<string, string>;
};

export type MediaSceneRenderer = {
  kind: string;
  mode: 'media';
  Component: ComponentType<MediaSceneRendererProps>;
};

export type SceneRenderer = CanvasSceneRenderer | MediaSceneRenderer;

export class SceneRegistry {
  private readonly renderers = new Map<string, SceneRenderer>();

  register(renderer: SceneRenderer): void {
    if (this.renderers.has(renderer.kind)) {
      throw new SceneRenderError(`Renderer already registered: ${renderer.kind}`);
    }
    this.renderers.set(renderer.kind, renderer);
  }

  has(kind: string): boolean {
    return this.renderers.has(kind);
  }

  get(kind: string): SceneRenderer {
    const renderer = this.renderers.get(kind);
    if (!renderer) throw new SceneRenderError(`No renderer registered for kind: ${kind}`);
    return renderer;
  }

  kinds(): string[] {
    return [...this.renderers.keys()];
  }

  list(): SceneRenderer[] {
    return [...this.renderers.values()];
  }
}
