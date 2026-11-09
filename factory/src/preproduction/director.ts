import type {LoadedProject, SceneParams} from '../config/types';
import {PreproductionError} from '../errors';
import {DEFAULT_SCENE_REGISTRY} from '../scenes/registry';
import type {
  AnnotationDocument,
  ApprovedBeatGrid,
  AssetRequirement,
  BeatGridReport,
  CreativeBrief,
  CreativeBriefRendererDirective,
  DirectorPlan,
  LyricsDocument,
  PlanChapter,
  PlanShot,
  PlanTimingSource,
  PlannedShotMedia,
  SectionAnnotation,
} from './types';
import {DIRECTOR_ALGORITHM_VERSION} from './types';

export type DirectorPlanInput = {
  project: LoadedProject;
  brief: CreativeBrief;
  annotations: AnnotationDocument;
  beatGrid: BeatGridReport | null;
  approvedBeatGrid: ApprovedBeatGrid | null;
  lyrics: LyricsDocument | null;
  revision: number;
  status?: 'proposed' | 'draft';
};

export const requirementFingerprint = (requirement: {
  shotIds: string[];
  renderer: string;
  kind: string;
  mediaSlot: string | null;
  durationFrames: number | null;
  aspectRatio: string;
  description: string;
}): string =>
  [
    [...requirement.shotIds].sort().join(','),
    requirement.renderer,
    requirement.kind,
    requirement.mediaSlot ?? '-',
    requirement.durationFrames ?? '-',
    requirement.aspectRatio,
    requirement.description,
  ].join('|');

type Timing = {
  manual: boolean;
  beatGridUsed: boolean;
  approvedGrid: ApprovedBeatGrid | null;
  beatFrames: number[];
  beatIdByFrame: ReadonlyMap<number, string>;
  beatSource: 'manual-anchor' | 'manual-bpm' | 'approved-grid' | 'none';
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const uniqueSorted = (values: number[]): number[] =>
  [...new Set(values.filter((value) => Number.isInteger(value)))].sort((a, b) => a - b);

const approved = <T extends {approval: string}>(items: T[]): T[] =>
  items.filter((item) => item.approval === 'approved');

const sectionCoverage = (sections: SectionAnnotation[], durationFrames: number): void => {
  if (sections.length === 0) {
    throw new PreproductionError('Approved annotations.sections are required for director planning');
  }
  if (sections[0].startFrame !== 0) {
    throw new PreproductionError('Approved annotations.sections must start at frame 0');
  }
  if (sections[sections.length - 1].endFrame !== durationFrames) {
    throw new PreproductionError('Approved annotations.sections must end at the project duration');
  }
  for (const section of sections) {
    if (section.approval !== 'approved') {
      throw new PreproductionError(`Section ${section.id} is not approved`);
    }
  }
  for (let index = 1; index < sections.length; index++) {
    if (sections[index].startFrame !== sections[index - 1].endFrame) {
      throw new PreproductionError('Approved annotations.sections contain a gap or overlap');
    }
  }
};

const manualBeatFrames = (input: DirectorPlanInput): number[] => {
  const anchors = approved(input.annotations.beatAnchors).map((anchor) => anchor.frame);
  if (anchors.length > 0) return uniqueSorted(anchors);
  const bpm = input.annotations.bpm;
  if (!bpm || bpm.approval !== 'approved') return [];
  const interval = (60 * input.project.config.output.fps) / bpm.value;
  if (!(interval >= 1)) return [];
  const phase = approved(input.annotations.cutCues)[0]?.frame ?? 0;
  const frames: number[] = [];
  for (let frame = phase; frame < input.project.durationInFrames; frame += interval) {
    frames.push(Math.round(frame));
  }
  return uniqueSorted(frames);
};

const resolveTiming = (input: DirectorPlanInput): Timing => {
  const manualBpm = input.annotations.bpm?.approval === 'approved';
  const anchors = approved(input.annotations.beatAnchors);
  const cuts = approved(input.annotations.cutCues);
  const manual = manualBpm || anchors.length > 0 || cuts.length > 0;
  const approvedGrid = input.approvedBeatGrid;
  if (manual) {
    return {
      manual: true,
      beatGridUsed: false,
      approvedGrid: null,
      beatFrames: manualBeatFrames(input),
      beatIdByFrame: new Map(anchors.map((anchor) => [anchor.frame, anchor.id])),
      beatSource: anchors.length > 0 ? 'manual-anchor' : manualBpm ? 'manual-bpm' : 'none',
    };
  }
  if (approvedGrid) {
    if (approvedGrid.source.sourceSha256 !== input.project.config.audio.sha256) {
      throw new PreproductionError(
        'The approved beat grid refers to different master audio; re-analyze and re-approve',
      );
    }
    if (approvedGrid.selected.beatFrames.some(
      (frame) => !Number.isInteger(frame) || frame < 0 || frame >= input.project.durationInFrames,
    )) {
      throw new PreproductionError('The approved beat grid contains a frame outside the project duration');
    }
    return {
      manual: false,
      beatGridUsed: true,
      approvedGrid,
      beatFrames: uniqueSorted(approvedGrid.selected.beatFrames),
      beatIdByFrame: new Map(
        approvedGrid.selected.beatFrames.map((frame, index) => [frame, approvedGrid.selected.beatIds[index]]),
      ),
      beatSource: 'approved-grid',
    };
  }
  throw new PreproductionError(
    'No approved timing source: provide approved manual BPM, beat anchors or cut cues, or approve a beat-grid candidate with approve-beats. Estimated beats are never promoted automatically.',
  );
};

const cloneMedia = (media: PlannedShotMedia): PlannedShotMedia => {
  if (media.kind === 'video') return {...media};
  if (media.kind === 'parallax-2p5d') {
    return {
      ...media,
      background: {...media.background},
      camera: {...media.camera},
      atmosphere: {...media.atmosphere},
      light: {...media.light},
      layers: media.layers.map((layer) => ({
        ...layer,
        ...(layer.motion === undefined ? {} : {motion: {...layer.motion}}),
      })),
      characters: media.characters.map((character) => ({
        ...character,
        poses: character.poses.map((pose) => ({...pose})),
      })),
    };
  }
  return {...media, overlay: {...media.overlay}, layers: media.layers.map((layer) => ({...layer}))};
};

const isMediaRendererKind = (renderer: string): boolean =>
  renderer === 'video' || renderer === 'hybrid' || renderer === 'parallax-2p5d';

const rendererAvailable = (input: DirectorPlanInput, renderer: string): boolean =>
  DEFAULT_SCENE_REGISTRY.kinds().includes(renderer) ||
  input.project.sceneModules.some((module) => renderer === `project:${module.id}`);

/**
 * Renderer selection is per shot, not per project. A brief with directives may
 * mix Canvas, project-module, Video and Hybrid shots in one storyboard; a shot
 * whose media requirement is unfulfilled stays blocked instead of being
 * silently downgraded to Canvas.
 */
const directiveFor = (
  input: DirectorPlanInput,
  index: number,
): CreativeBriefRendererDirective | null => {
  const directives = input.brief.rendererDirectives;
  if (directives.length === 0) return null;
  const directive = directives[index % directives.length];
  if (!rendererAvailable(input, directive.renderer)) {
    throw new PreproductionError(
      `Renderer directive ${directive.id} references unavailable renderer ${directive.renderer}`,
    );
  }
  return directive;
};

const pickRenderer = (input: DirectorPlanInput): string => {
  for (const renderer of input.brief.preferredRenderers) {
    if (rendererAvailable(input, renderer)) return renderer;
  }
  throw new PreproductionError('No preferred renderer is available in the project registry');
};

const pick = <T>(values: readonly T[], index: number, fallback: T): T =>
  values.length > 0 ? values[index % values.length] : fallback;

const rendererParams = (
  input: DirectorPlanInput,
  renderer: string,
  index: number,
): SceneParams => {
  const palette = input.brief.palette.length > 0 ? input.brief.palette : ['#0B1B2B', '#2EC4B6', '#FF9F1C'];
  const params: SceneParams = {
    background: pick(palette, index, palette[0]),
    accent: pick(palette, index + 1, palette[1 % palette.length]),
    secondary: pick(palette, index + 2, palette[2 % palette.length]),
    motion: 1.5 + (index % 4) * 0.6,
  };
  if (renderer === 'pixel-canvas') {
    params.bars = 4 + (index % 5);
  }
  return params;
};

const nearest = (values: number[], target: number, minimum: number, maximum: number): number | null => {
  let best: number | null = null;
  for (const value of values) {
    if (value < minimum || value > maximum) continue;
    if (best === null || Math.abs(value - target) < Math.abs(best - target)) best = value;
  }
  return best;
};

const timingSourceFor = (
  frame: number,
  input: DirectorPlanInput,
  timing: Timing,
): {source: PlanTimingSource; cueId: string | null} => {
  const cut = approved(input.annotations.cutCues).find((item) => item.frame === frame);
  if (cut) return {source: 'manual-cut', cueId: cut.id};
  const anchor = approved(input.annotations.beatAnchors).find((item) => item.frame === frame);
  if (anchor) return {source: 'manual-beat', cueId: anchor.id};
  if (timing.beatSource === 'manual-bpm' && timing.beatFrames.includes(frame)) {
    return {source: 'manual-bpm', cueId: null};
  }
  if (timing.beatSource === 'approved-grid' && timing.beatFrames.includes(frame)) {
    return {source: 'approved-beat-grid', cueId: timing.beatIdByFrame.get(frame) ?? null};
  }
  const projectCue = input.project.config.cues.find((cue) => cue.frame === frame);
  if (projectCue) return {source: 'project-cue', cueId: projectCue.id};
  const lyric = input.lyrics?.lines.find((line) => line.frame === frame);
  if (lyric) return {source: 'lyric', cueId: lyric.id};
  return {source: 'section', cueId: null};
};

const makeShotsForSection = (
  input: DirectorPlanInput,
  section: SectionAnnotation,
  chapterId: string,
  timing: Timing,
  renderer: string,
  startIndex: number,
): PlanShot[] => {
  const cuts = approved(input.annotations.cutCues).map((cut) => cut.frame);
  const lyricCuts = input.lyrics?.lines.map((line) => line.frame) ?? [];
  const projectCues = input.project.config.cues.map((cue) => cue.frame);
  const candidates = uniqueSorted([
    ...cuts,
    ...(input.brief.pacing.allowBeatCuts ? timing.beatFrames : []),
    ...lyricCuts,
    ...projectCues,
  ]).filter((frame) => frame > section.startFrame && frame < section.endFrame);
  const {minShotFrames, maxShotFrames, preferredShotFrames} = input.brief.pacing;
  const boundaries: number[] = [section.startFrame];
  let cursor = section.startFrame;
  while (section.endFrame - cursor > maxShotFrames) {
    const lower = cursor + minShotFrames;
    const upper = Math.min(cursor + maxShotFrames, section.endFrame - minShotFrames);
    const target = cursor + clamp(preferredShotFrames, minShotFrames, maxShotFrames);
    const candidate = nearest(candidates, target, lower, upper);
    const cut = candidate ?? Math.min(section.endFrame - minShotFrames, cursor + maxShotFrames);
    if (cut <= cursor) break;
    boundaries.push(cut);
    cursor = cut;
  }
  boundaries.push(section.endFrame);
  const shots: PlanShot[] = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const startFrame = boundaries[index];
    const endFrame = boundaries[index + 1];
    const shotIndex = startIndex + index;
    const directive = directiveFor(input, shotIndex);
    const shotRenderer = directive?.renderer ?? renderer;
    const lyric = input.lyrics?.lines.find(
      (line) => line.frame >= startFrame && line.frame < endFrame,
    );
    const timingInfo = timingSourceFor(startFrame, input, timing);
    const mood = pick(input.brief.moodProgression, shotIndex, section.label);
    const camera = pick(input.brief.cameraLanguage, shotIndex, 'steady observational framing');
    const movement = pick(
      ['slow push in', 'lateral drift', 'locked frame', 'gentle pull back', 'handheld follow'],
      shotIndex,
      'slow push in',
    );
    const transition = pick(input.brief.transitions, shotIndex, 'hard cut on the beat');
    const characterText = input.brief.characters.length > 0
      ? input.brief.characters.join(', ')
      : 'no recurring character is specified';
    const purpose =
      index === 0
        ? `Establish ${section.label} through ${input.brief.concept}`
        : index === boundaries.length - 2
          ? `Resolve ${section.label} with ${mood}`
          : `Develop ${section.label} with ${mood}`;
    const visualDescription = [
      `${input.brief.visualStyle} treatment of ${input.brief.setting}`,
      `${characterText}; palette ${input.brief.palette.join(' / ') || 'defined by the brief'}`,
      `${camera}, ${movement}`,
      transition,
      lyric ? `lyric association: "${lyric.text}"` : 'instrumental visual passage',
    ].join('. ');
    shots.push({
      id: `SHOT-${String(shotIndex + 1).padStart(3, '0')}`,
      chapterId,
      startFrame,
      endFrame,
      purpose,
      visualDescription,
      renderer: shotRenderer,
      rendererParams: rendererParams(input, shotRenderer, shotIndex),
      camera,
      movement,
      colorAndLighting: `${mood}; ${pick(input.brief.moodProgression, shotIndex + 1, 'controlled contrast')}`,
      characterReferences: [...input.brief.characters],
      environmentReference: input.brief.setting,
      timingRationale:
        timingInfo.source === 'approved-beat-grid'
          ? `Approved beat-grid cut at frame ${startFrame}: beat ${timingInfo.cueId ?? 'unknown'} of the ${
              timing.approvedGrid?.selected.bpm
            } BPM ${timing.approvedGrid?.selected.interpretation} interpretation, approved in revision ${
              timing.approvedGrid?.selected.approvalRevision
            }.`
          : timingInfo.source === 'manual-beat' || timingInfo.source === 'manual-bpm'
            ? `Approved manual beat cut at frame ${startFrame}.`
            : timingInfo.source === 'manual-cut'
              ? `Approved manual cut cue at frame ${startFrame}.`
              : timingInfo.source === 'lyric'
                ? `Lyric annotation cut at frame ${startFrame}.`
                : timingInfo.source === 'project-cue'
                  ? `Approved project cue at frame ${startFrame}.`
                  : `Section boundary at frame ${startFrame}; no automatic transient promotion.`,
      timingSource: timingInfo.source,
      sourceFrame: timingInfo.source === 'section' ? section.startFrame : startFrame,
      cueId: timingInfo.cueId,
      assetRequirementIds: [],
      continuityReferences: [
        input.brief.setting,
        ...input.brief.characters,
        ...input.brief.continuityRules.slice(0, 2),
      ].filter((value): value is string => Boolean(value)),
      continuityIds: directive ? [...directive.continuityIds] : [],
      media: directive?.media ? cloneMedia(directive.media) : null,
      reviewStatus: 'draft',
      assumptions: [
        ...input.brief.assumptions,
        'Generated visual descriptions are editable suggestions, not semantic understanding of the audio.',
      ],
    });
  }
  return shots;
};

export const generateDirectorPlan = (input: DirectorPlanInput): DirectorPlan => {
  if (input.brief.approval !== 'approved') {
    throw new PreproductionError('creative brief must be approved before plan generation');
  }
  if (input.brief.projectId !== input.project.config.projectId) {
    throw new PreproductionError('creative brief projectId does not match the loaded project');
  }
  const sections = approved(input.annotations.sections).sort(
    (left, right) => left.startFrame - right.startFrame,
  );
  sectionCoverage(sections, input.project.durationInFrames);
  const timing = resolveTiming(input);
  const renderer = pickRenderer(input);
  const chapters: PlanChapter[] = [];
  let shotIndex = 0;
  for (const [index, section] of sections.entries()) {
    const chapterId = `CH-${String(index + 1).padStart(2, '0')}`;
    const shots = makeShotsForSection(input, section, chapterId, timing, renderer, shotIndex);
    if (shots.length === 0) throw new PreproductionError(`Section ${section.id} produced no shots`);
    shotIndex += shots.length;
    chapters.push({
      id: chapterId,
      title: section.label,
      label: section.label,
      sectionId: section.id,
      startFrame: section.startFrame,
      endFrame: section.endFrame,
      shots,
    });
  }
  const allShots = chapters.flatMap((chapter) => chapter.shots);
  const requirements: AssetRequirement[] = [];
  const addRequirement = (
    shot: PlanShot,
    draft: Omit<AssetRequirement, 'id' | 'shotIds'>,
  ): AssetRequirement => {
    const requirement: AssetRequirement = {
      ...draft,
      id: `REQ-${String(requirements.length + 1).padStart(3, '0')}`,
      shotIds: [shot.id],
    };
    requirements.push(requirement);
    shot.assetRequirementIds.push(requirement.id);
    return requirement;
  };
  const baseProvenance =
    'User-supplied or approved local asset; provenance and rights must be recorded at attachment. No provider generation is authorized in this phase.';
  for (const shot of allShots) {
    const media = shot.media;
    if (!media) continue;
    const shotLength = shot.endFrame - shot.startFrame;
    if (media.kind === 'parallax-2p5d') {
      const background = addRequirement(shot, {
        kind: 'image',
        description: `Opaque 2.5D background plate for ${shot.id}: ${shot.purpose}`,
        visualStyle: shot.visualDescription,
        aspectRatio: input.brief.aspectRatio,
        durationFrames: null,
        alphaRequired: false,
        continuityReferences: [...shot.continuityIds],
        provenanceRequirements: baseProvenance,
        renderer: shot.renderer,
        status: 'needed',
        approval: 'draft',
        fulfilledAssetId: null,
        path: null,
        sha256: null,
        mediaSlot: media.backgroundSlot,
        fingerprint: '',
      });
      background.fingerprint = requirementFingerprint(background);
      for (const layer of media.layers) {
        if (layer.visibleFromFrame >= layer.visibleToFrame || layer.visibleToFrame > shotLength) {
          throw new PreproductionError(
            `Shot ${shot.id} layer slot ${layer.slot} has an invalid shot-local visibility range`,
          );
        }
        const requirement = addRequirement(shot, {
          kind: 'layer',
          description: `Transparent ${layer.role} layer ${layer.slot} for ${shot.id} at order ${layer.order}`,
          visualStyle: shot.visualDescription,
          aspectRatio: input.brief.aspectRatio,
          durationFrames: layer.visibleToFrame - layer.visibleFromFrame,
          alphaRequired: true,
          continuityReferences: [...shot.continuityIds],
          provenanceRequirements: baseProvenance,
          renderer: shot.renderer,
          status: 'needed',
          approval: 'draft',
          fulfilledAssetId: null,
          path: null,
          sha256: null,
          mediaSlot: layer.slot,
          fingerprint: '',
        });
        requirement.fingerprint = requirementFingerprint(requirement);
      }
      for (const character of media.characters) {
        let cursor = 0;
        for (const pose of character.poses) {
          if (pose.fromFrame !== cursor || pose.toFrame > shotLength) {
            throw new PreproductionError(
              `Shot ${shot.id} character ${character.characterId} poses must tile the shot in order`,
            );
          }
          cursor = pose.toFrame;
          const requirement = addRequirement(shot, {
            kind: 'layer',
            description: `Character ${character.characterId} pose ${pose.slot} for ${shot.id}`,
            visualStyle: shot.visualDescription,
            aspectRatio: input.brief.aspectRatio,
            durationFrames: pose.toFrame - pose.fromFrame,
            alphaRequired: true,
            continuityReferences: [...shot.continuityIds],
            provenanceRequirements: baseProvenance,
            renderer: shot.renderer,
            status: 'needed',
            approval: 'draft',
            fulfilledAssetId: null,
            path: null,
            sha256: null,
            mediaSlot: pose.slot,
            fingerprint: '',
          });
          requirement.fingerprint = requirementFingerprint(requirement);
        }
        if (cursor !== shotLength) {
          throw new PreproductionError(
            `Shot ${shot.id} character ${character.characterId} poses end at ${cursor} but the shot lasts ${shotLength}`,
          );
        }
      }
      continue;
    }
    if (media.sourceStartFrames + shotLength > Number.MAX_SAFE_INTEGER) {
      throw new PreproductionError(`Shot ${shot.id} requests an out-of-range video in-point`);
    }
    const background = addRequirement(shot, {
      kind: 'video',
      description: `Video background for ${shot.id}: ${shot.purpose}`,
      visualStyle: shot.visualDescription,
      aspectRatio: input.brief.aspectRatio,
      durationFrames: media.sourceStartFrames + shotLength,
      alphaRequired: false,
      continuityReferences: [...shot.continuityIds],
      provenanceRequirements: baseProvenance,
      renderer: shot.renderer,
      status: 'needed',
      approval: 'draft',
      fulfilledAssetId: null,
      path: null,
      sha256: null,
      mediaSlot: media.backgroundSlot,
      fingerprint: '',
    });
    background.fingerprint = requirementFingerprint(background);
    if (media.kind !== 'hybrid') continue;
    for (const layer of media.layers) {
      if (layer.visibleFromFrame >= layer.visibleToFrame) {
        throw new PreproductionError(
          `Shot ${shot.id} layer slot ${layer.slot} has an empty shot-local visibility range`,
        );
      }
      if (layer.visibleToFrame > shotLength) {
        throw new PreproductionError(
          `Shot ${shot.id} layer slot ${layer.slot} is visible to frame ${layer.visibleToFrame}, beyond the shot length ${shotLength}`,
        );
      }
      const layerRequirement = addRequirement(shot, {
        kind: 'layer',
        description: `Transparent PNG layer ${layer.slot} for ${shot.id} at order ${layer.order}`,
        visualStyle: shot.visualDescription,
        aspectRatio: input.brief.aspectRatio,
        durationFrames: layer.visibleToFrame - layer.visibleFromFrame,
        alphaRequired: true,
        continuityReferences: [...shot.continuityIds],
        provenanceRequirements: baseProvenance,
        renderer: shot.renderer,
        status: 'needed',
        approval: 'draft',
        fulfilledAssetId: null,
        path: null,
        sha256: null,
        mediaSlot: layer.slot,
        fingerprint: '',
      });
      layerRequirement.fingerprint = requirementFingerprint(layerRequirement);
    }
  }
  for (const need of input.brief.requiredAssets) {
    const targetShot = allShots[requirements.length % allShots.length];
    const requirement = addRequirement(targetShot, {
      kind: need.kind,
      description: need.description,
      visualStyle: need.visualStyle ?? input.brief.visualStyle,
      aspectRatio: input.brief.aspectRatio,
      durationFrames: need.durationFrames ?? null,
      alphaRequired: need.alphaRequired ?? false,
      continuityReferences: [
        ...(need.continuityReferences ?? []),
        ...targetShot.continuityIds,
      ],
      provenanceRequirements: baseProvenance,
      renderer: targetShot.renderer,
      status: 'needed',
      approval: 'draft',
      fulfilledAssetId: null,
      path: null,
      sha256: null,
      mediaSlot: null,
      fingerprint: '',
    });
    requirement.fingerprint = requirementFingerprint(requirement);
  }
  const timingNotes = [
    timing.manual
      ? 'Approved manual BPM, beat anchors or cut cues take precedence over any beat grid.'
      : 'Timing uses the explicitly approved beat-grid candidate; the estimate itself was never promoted.',
    timing.beatSource === 'approved-grid'
      ? `Approved interpretation: ${timing.approvedGrid?.selected.bpm} BPM (${
          timing.approvedGrid?.selected.interpretation
        }), estimated from ${timing.approvedGrid?.source.candidateBpm} BPM at confidence ${(
          timing.approvedGrid?.source.confidence ?? 0
        ).toFixed(3)}, quality ${timing.approvedGrid?.source.quality}.${
          timing.approvedGrid &&
          (timing.approvedGrid.source.ambiguity.halfTempo || timing.approvedGrid.source.ambiguity.doubleTempo)
            ? ' Competing tempo interpretations remain recorded in the approval.'
            : ''
        }`
      : `Beat timing source: ${timing.beatSource}.`,
    `Section count: ${sections.length}; shots generated: ${allShots.length}.`,
    input.brief.rendererDirectives.length > 0
      ? `Renderer directives are applied per shot: ${allShots
          .map((shot) => `${shot.id}=${shot.renderer}${shot.media ? ` (${shot.media.kind} slots pending)` : ''}`)
          .join(', ')}.`
      : 'All shots use the single preferred renderer from the brief.',
    ...(input.brief.pacing.allowBeatCuts
      ? ['Beat cuts are optional guidance and are not applied to every detected transient.']
      : ['Beat cuts are disabled by the creative pacing policy.']),
  ];
  return {
    schemaVersion: 1,
    projectId: input.project.config.projectId,
    revision: input.revision,
    algorithmVersion: DIRECTOR_ALGORITHM_VERSION,
    status: input.status ?? 'proposed',
    source: {
      audioSha256: input.project.config.audio.sha256,
      durationFrames: input.project.durationInFrames,
      fps: input.project.config.output.fps,
      beatGridUsed: timing.beatGridUsed,
      approvedBeatGridUsed: timing.approvedGrid !== null,
      approvedBeatGrid: timing.approvedGrid
        ? {
            bpm: timing.approvedGrid.selected.bpm,
            interpretation: timing.approvedGrid.selected.interpretation,
            confidence: timing.approvedGrid.source.confidence,
            quality: timing.approvedGrid.source.quality,
            approvalRevision: timing.approvedGrid.selected.approvalRevision,
            candidateBeatIds: [...timing.approvedGrid.source.candidateBeatIds],
            selectedBeatIds: [...timing.approvedGrid.selected.beatIds],
          }
        : null,
      beatConfidence: input.beatGrid?.estimatedTempo?.confidence ?? null,
      manualTimingUsed: timing.manual,
      lyricLineCount: input.lyrics?.lines.length ?? 0,
    },
    brief: {
      concept: input.brief.concept,
      visualStyle: input.brief.visualStyle,
      aspectRatio: input.brief.aspectRatio,
      moodProgression: [...input.brief.moodProgression],
      assumptions: [...input.brief.assumptions],
    },
    chapters,
    assetRequirements: requirements,
    timingNotes,
    reviewNotes: [
      'Plan is generated from explicit creative intent and verified timing inputs.',
      'Review shot descriptions, renderer choices and any missing asset requirements before approval.',
    ],
  };
};