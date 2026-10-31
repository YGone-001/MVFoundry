import {AbsoluteFill, Audio, Img, staticFile, useCurrentFrame} from 'remotion';
import {useLayoutEffect, useMemo, useRef} from 'react';
import type {RenderProjectSnapshot, RenderProjectShot} from '../config/types';
import {createDefaultSceneRegistry, DEFAULT_SCENE_REGISTRY} from '../scenes/registry';
import type {SceneRenderer} from '../scenes/types';
import {buildSceneFrameInfo} from '../timeline/frameClock';
import {resolveShotAtFrame, resolveShots} from '../timeline/resolver';

export type FactoryFilmProps = {
  project: RenderProjectSnapshot;
  extraRenderers?: SceneRenderer[];
};

const flattenShots = (project: RenderProjectSnapshot): RenderProjectShot[] =>
  project.chapters.flatMap((chapter) => chapter.shots);

export const FactoryFilm: React.FC<FactoryFilmProps> = ({project, extraRenderers}) => {
  const frame = useCurrentFrame();
  const ref = useRef<HTMLCanvasElement>(null);

  const registry = useMemo(() => {
    if (!extraRenderers || extraRenderers.length === 0) return DEFAULT_SCENE_REGISTRY;
    const created = createDefaultSceneRegistry();
    for (const renderer of extraRenderers) created.register(renderer);
    return created;
  }, [extraRenderers]);

  const resolvedShots = useMemo(
    () =>
      resolveShots(
        project.chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          startFrame: chapter.startFrame,
          endFrame: chapter.endFrame,
          shots: chapter.shots,
        })),
      ),
    [project],
  );
  const shot = resolveShotAtFrame(resolvedShots, frame, project.output.durationInFrames);
  const renderer = registry.get(shot.shot.renderer);
  const MediaComponent = renderer.mode === 'media' ? renderer.Component : null;
  const canvasRenderer = renderer.mode === 'media' ? null : renderer;
  const size = canvasRenderer
    ? canvasRenderer.canvasSize(project, shot.shot as RenderProjectShot)
    : null;
  const samplingFps = canvasRenderer
    ? canvasRenderer.samplingFps(project, shot.shot as RenderProjectShot)
    : null;
  const isPixel = canvasRenderer
    ? canvasRenderer.pixelated ?? canvasRenderer.kind === 'pixel-canvas'
    : false;
  const backgroundPublicPath =
    canvasRenderer && shot.shot.params.assetId
      ? project.publicAssets[shot.shot.params.assetId]
      : undefined;

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || !canvasRenderer || !size || samplingFps === null) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size.width, size.height);

    const frameInfo = buildSceneFrameInfo(
      frame,
      shot.shot.startFrame,
      project.output.fps,
      samplingFps,
      project.output.durationInFrames,
    );
    canvasRenderer.render(ctx, {
      project,
      shot: shot.shot as RenderProjectShot,
      frame: frameInfo,
      publicAssets: project.publicAssets,
    });
  }, [canvasRenderer, frame, project, samplingFps, shot, size?.height, size?.width]);

  return (
    <AbsoluteFill
      data-project={project.projectId}
      data-shot={shot.shot.id}
      data-renderer={renderer.kind}
      style={{backgroundColor: '#000'}}
    >
      {MediaComponent ? (
        <MediaComponent
          project={project}
          shot={shot.shot as RenderProjectShot}
          publicAssets={project.publicAssets}
        />
      ) : (
        <>
          {backgroundPublicPath ? (
            <Img
              src={staticFile(backgroundPublicPath)}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          ) : null}
          {canvasRenderer && size ? (
            <canvas
              ref={ref}
              width={size.width}
              height={size.height}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                imageRendering: isPixel ? 'pixelated' : 'auto',
              }}
            />
          ) : null}
        </>
      )}
      {project.audioPublicPath ? <Audio src={staticFile(project.audioPublicPath)} /> : null}
    </AbsoluteFill>
  );
};

export {flattenShots};
