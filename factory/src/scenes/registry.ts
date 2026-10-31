import {hybridSceneRenderer} from './renderers/hybrid';
import {layeredCanvasRenderer} from './renderers/layeredCanvas';
import {pixelCanvasRenderer} from './renderers/pixelCanvas';
import {videoSceneRenderer} from './renderers/video';
import {SceneRegistry} from './types';

export const createDefaultSceneRegistry = (): SceneRegistry => {
  const registry = new SceneRegistry();
  registry.register(pixelCanvasRenderer);
  registry.register(layeredCanvasRenderer);
  registry.register(videoSceneRenderer);
  registry.register(hybridSceneRenderer);
  return registry;
};

export const DEFAULT_SCENE_REGISTRY = createDefaultSceneRegistry();
