// Style-aware planning compatibility.
//
// A selected visual style is a planning constraint, not only a render-time
// check. The creative brief, director plan and storyboard must reject a
// renderer the style never declared instead of letting compilation discover it
// much later.
//
// This helper is intentionally pure: it reads the loaded project and the
// catalog, never the filesystem.

import type {LoadedProject} from '../config/types';
import {PreproductionError} from '../errors';
import {PROJECT_SCENE_RENDERER_PREFIX} from '../scenes/external/constants';
import {
  getStyleMediaRoute,
  getStyleProfile,
  type MediaRendererKind,
} from '../style/catalog';

const MEDIA_RENDERERS: readonly MediaRendererKind[] = ['video', 'hybrid', 'parallax-2p5d'];

export type StyleCompatibilityContext = {
  styleId?: string;
  /** Scene module ids that explicitly declare the selected style. */
  styleModuleIds?: ReadonlySet<string>;
};

/**
 * A missing style keeps legacy behaviour. Once a style is selected, every
 * planned renderer must be either a style-declaring project module or a media
 * renderer named in that style's `mediaRoutes`.
 */
export const assertRendererAllowedByStyle = (
  context: StyleCompatibilityContext,
  renderer: string,
  label: string,
): void => {
  if (!context.styleId) return;
  const styleId = context.styleId;
  const profile = getStyleProfile(styleId);
  if (!profile) {
    throw new PreproductionError(`visual style ${styleId} is not registered`);
  }

  if (renderer.startsWith(PROJECT_SCENE_RENDERER_PREFIX)) {
    const moduleId = renderer.slice(PROJECT_SCENE_RENDERER_PREFIX.length);
    if (!context.styleModuleIds || !context.styleModuleIds.has(moduleId)) {
      throw new PreproductionError(
        `${label} uses scene module ${moduleId}, which does not declare visual style ${styleId}`,
      );
    }
    return;
  }

  if ((MEDIA_RENDERERS as readonly string[]).includes(renderer)) {
    if (!getStyleMediaRoute(profile, renderer as MediaRendererKind)) {
      throw new PreproductionError(
        `${label} uses ${renderer}, which style ${styleId} does not declare; declared media routes: ${profile.mediaRoutes.map((entry) => entry.renderer).join(', ') || 'none'}`,
      );
    }
    return;
  }

  throw new PreproductionError(
    `${label} uses ${renderer}, which is not allowed by visual style ${styleId}; use a style-declared project module or a style-declared media renderer`,
  );
};

export const styleCompatibilityForProject = (project: LoadedProject): StyleCompatibilityContext => {
  const styleId = project.config.visual.style?.id;
  if (!styleId) return {};
  return {
    styleId,
    styleModuleIds: new Set(
      project.sceneModules
        .filter((module) => module.styleIds?.includes(styleId))
        .map((module) => module.id),
    ),
  };
};

export const assertRendererAllowedByProject = (
  project: LoadedProject,
  renderer: string,
  label: string,
): void => assertRendererAllowedByStyle(styleCompatibilityForProject(project), renderer, label);