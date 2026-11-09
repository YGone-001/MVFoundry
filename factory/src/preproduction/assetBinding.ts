import type {AssetRequirementKind} from './types';

/**
 * Renderer / asset-kind compatibility for local asset intake.
 *
 * Planned media is bound through the existing intake table, so the binding
 * guard must describe what each renderer can actually consume. This is a
 * closed list: an unknown renderer or an unexpected kind is refused before an
 * intake record is written, never inferred from the requirement description.
 *
 * - `layered-canvas` draws one approved opaque still image as an overlay.
 * - `video` plays one approved local clip.
 * - `hybrid` plays one clip and draws approved RGBA layers over it.
 * - `parallax-2p5d` takes an opaque `image` background plate and RGBA `layer`
 *   depth/pose cutouts. A direct `project.json` 2.5D shot can also carry a video
 *   background, but the planned authoring path does not emit a video requirement,
 *   so intake stays on the two kinds it can produce.
 */
export const requirementSupportsRenderer = (
  kind: AssetRequirementKind,
  renderer: string,
): boolean => {
  switch (renderer) {
    case 'layered-canvas':
      return kind === 'image';
    case 'video':
      return kind === 'video';
    case 'hybrid':
      return kind === 'video' || kind === 'layer';
    case 'parallax-2p5d':
      return kind === 'image' || kind === 'layer';
    default:
      return false;
  }
};