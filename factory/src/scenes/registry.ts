import {layeredCanvasRenderer} from './renderers/layeredCanvas';
import {pixelCanvasRenderer} from './renderers/pixelCanvas';
import {hybridRenderer, videoRenderer} from './renderers/placeholders';
import {SceneRegistry} from './types';

export const createDefaultSceneRegistry = (): SceneRegistry => {
  const registry = new SceneRegistry();
  registry.register(pixelCanvasRenderer);
  registry.register(layeredCanvasRenderer);
  registry.register(videoRenderer);
  registry.register(hybridRenderer);
  return registry;
};

export const DEFAULT_SCENE_REGISTRY = createDefaultSceneRegistry();
