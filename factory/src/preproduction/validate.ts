import {PreproductionError} from '../errors';
import type {ProjectAsset} from '../config/types';
import type {
  AnnotationDocument,
  ApprovedBeatGrid,
  ApprovalStatus,
  AssetRequirement,
  BeatGridInterpretation,
  BeatGridReport,
  CreativeBrief,
  CreativeBriefAssetNeed,
  CreativeBriefPacing,
  LyricsDocument,
  LyricLine,
  ManualBeatAnchor,
  ManualBpm,
  ManualCutCue,
  SectionAnnotation,
} from './types';
import {BEAT_GRID_ALGORITHM_VERSION} from './types';

export type PreproductionContext = {
  projectId: string;
  fps: number;
  durationInFrames: number;
  width: number;
  height: number;
  assets: ProjectAsset[];
  rendererKinds: ReadonlySet<string>;
  sections?: SectionAnnotation[];
};

const APPROVALS: readonly ApprovalStatus[] = ['draft', 'proposed', 'approved', 'rejected'];
const BEAT_INTERPRETATIONS: readonly BeatGridInterpretation[] = ['as-estimated', 'half-tempo'];
const SOURCE_KINDS = ['user'] as const;
const NARRATIVE_MODES = ['narrative', 'abstract', 'lyric', 'hybrid'] as const;
const ASSET_KINDS = ['image', 'video', 'layer', 'scene-module', 'existing-asset'] as const;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

function fail(message: string): never {
  throw new PreproductionError(message);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const record = (value: unknown, field: string): Record<string, unknown> => {
  if (!isRecord(value)) fail(`${field} must be an object`);
  return value;
};

const text = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} must be a non-empty string`);
  return value;
};

const optionalText = (value: unknown, field: string): string | undefined =>
  value === undefined ? undefined : text(value, field);

const integer = (value: unknown, field: string, minimum = 0): number => {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    fail(`${field} must be an integer >= ${minimum}`);
  }
  return value as number;
};

const number = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} must be finite`);
  return value;
};

const boolean = (value: unknown, field: string): boolean => {
  if (typeof value !== 'boolean') fail(`${field} must be a boolean`);
  return value;
};

const array = (value: unknown, field: string): unknown[] => {
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  return value;
};

const textArray = (value: unknown, field: string, maximum = 64): string[] => {
  if (value === undefined) return [];
  const items = array(value, field);
  if (items.length > maximum) fail(`${field} must contain at most ${maximum} entries`);
  return items.map((item, index) => text(item, `${field}[${index}]`));
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    fail(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
};

const approval = (value: unknown, field: string): ApprovalStatus =>
  oneOf(value, APPROVALS, field);

const userSource = (value: unknown, field: string): 'user' => {
  if (value !== 'user') fail(`${field} must be "user" for manual annotations`);
  return 'user';
};

const assertKeys = (value: Record<string, unknown>, allowed: readonly string[], field: string): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${field} contains unsupported key ${key}`);
  }
};

const uniqueIds = (items: Array<{id: string}>, field: string): void => {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail(`${field} contains duplicate id ${item.id}`);
    seen.add(item.id);
  }
};

const assertFrameTime = (frame: number, timeSeconds: number, fps: number, field: string): void => {
  if (timeSeconds < 0) fail(`${field}.timeSeconds must be non-negative`);
  if (Math.abs(frame / fps - timeSeconds) > 1 / (2 * fps) + 1e-9) {
    fail(`${field} frame/time disagree: ${frame}/${fps} != ${timeSeconds}`);
  }
};

const validateManualBpm = (value: unknown): ManualBpm | null => {
  if (value === null || value === undefined) return null;
  const item = record(value, 'annotations.bpm');
  assertKeys(item, ['value', 'source', 'approval', 'notes'], 'annotations.bpm');
  const result: ManualBpm = {
    value: number(item.value, 'annotations.bpm.value'),
    source: userSource(item.source, 'annotations.bpm.source'),
    approval: approval(item.approval, 'annotations.bpm.approval'),
  };
  if (result.value < 1 || result.value > 400) fail('annotations.bpm.value must be in [1, 400]');
  const notes = optionalText(item.notes, 'annotations.bpm.notes');
  if (notes !== undefined) result.notes = notes;
  return result;
};

const validateBeatAnchor = (value: unknown, index: number, context: PreproductionContext): ManualBeatAnchor => {
  const field = `annotations.beatAnchors[${index}]`;
  const item = record(value, field);
  assertKeys(item, ['id', 'frame', 'timeSeconds', 'source', 'approval', 'notes'], field);
  const frame = integer(item.frame, `${field}.frame`);
  if (frame >= context.durationInFrames) fail(`${field}.frame must be inside the project duration`);
  const timeSeconds = number(item.timeSeconds, `${field}.timeSeconds`);
  assertFrameTime(frame, timeSeconds, context.fps, field);
  const result: ManualBeatAnchor = {
    id: text(item.id, `${field}.id`),
    frame,
    timeSeconds,
    source: userSource(item.source, `${field}.source`),
    approval: approval(item.approval, `${field}.approval`),
  };
  const notes = optionalText(item.notes, `${field}.notes`);
  if (notes !== undefined) result.notes = notes;
  return result;
};

const validateCutCue = (value: unknown, index: number, context: PreproductionContext): ManualCutCue => {
  const field = `annotations.cutCues[${index}]`;
  const item = record(value, field);
  assertKeys(item, ['id', 'frame', 'timeSeconds', 'label', 'source', 'approval', 'notes'], field);
  const frame = integer(item.frame, `${field}.frame`);
  if (frame >= context.durationInFrames) fail(`${field}.frame must be inside the project duration`);
  const timeSeconds = number(item.timeSeconds, `${field}.timeSeconds`);
  assertFrameTime(frame, timeSeconds, context.fps, field);
  const result: ManualCutCue = {
    id: text(item.id, `${field}.id`),
    frame,
    timeSeconds,
    label: text(item.label, `${field}.label`),
    source: userSource(item.source, `${field}.source`),
    approval: approval(item.approval, `${field}.approval`),
  };
  const notes = optionalText(item.notes, `${field}.notes`);
  if (notes !== undefined) result.notes = notes;
  return result;
};

const validateSection = (value: unknown, index: number, context: PreproductionContext): SectionAnnotation => {
  const field = `annotations.sections[${index}]`;
  const item = record(value, field);
  assertKeys(item, ['id', 'label', 'startFrame', 'endFrame', 'source', 'approval', 'notes'], field);
  const startFrame = integer(item.startFrame, `${field}.startFrame`);
  const endFrame = integer(item.endFrame, `${field}.endFrame`);
  if (endFrame <= startFrame) fail(`${field} must satisfy startFrame < endFrame`);
  if (endFrame > context.durationInFrames) fail(`${field}.endFrame exceeds the project duration`);
  const result: SectionAnnotation = {
    id: text(item.id, `${field}.id`),
    label: text(item.label, `${field}.label`),
    startFrame,
    endFrame,
    source: userSource(item.source, `${field}.source`),
    approval: approval(item.approval, `${field}.approval`),
  };
  const notes = optionalText(item.notes, `${field}.notes`);
  if (notes !== undefined) result.notes = notes;
  return result;
};

export const validateAnnotations = (
  raw: unknown,
  context: PreproductionContext,
  options: {requireApproved?: boolean; requireCoverage?: boolean} = {},
): AnnotationDocument => {
  const document = record(raw, 'annotations');
  assertKeys(document, ['schemaVersion', 'projectId', 'bpm', 'beatAnchors', 'cutCues', 'sections'], 'annotations');
  if (document.schemaVersion !== 1) fail('annotations.schemaVersion must be 1');
  if (text(document.projectId, 'annotations.projectId') !== context.projectId) {
    fail(`annotations.projectId must be ${context.projectId}`);
  }
  const bpm = validateManualBpm(document.bpm);
  const rawAnchors = document.beatAnchors === undefined ? [] : array(document.beatAnchors, 'annotations.beatAnchors');
  const rawCuts = document.cutCues === undefined ? [] : array(document.cutCues, 'annotations.cutCues');
  const rawSections = document.sections === undefined ? [] : array(document.sections, 'annotations.sections');
  if (rawAnchors.length > 512) fail('annotations.beatAnchors must contain at most 512 entries');
  if (rawCuts.length > 256) fail('annotations.cutCues must contain at most 256 entries');
  if (rawSections.length > 64) fail('annotations.sections must contain at most 64 entries');

  const beatAnchors = rawAnchors.map((item, index) => validateBeatAnchor(item, index, context));
  const cutCues = rawCuts.map((item, index) => validateCutCue(item, index, context));
  const sections = rawSections.map((item, index) => validateSection(item, index, context));
  uniqueIds(beatAnchors, 'annotations.beatAnchors');
  uniqueIds(cutCues, 'annotations.cutCues');
  uniqueIds(sections, 'annotations.sections');
  for (let index = 1; index < beatAnchors.length; index++) {
    if (beatAnchors[index].frame <= beatAnchors[index - 1].frame) {
      fail('annotations.beatAnchors must have strictly increasing frames');
    }
  }
  for (let index = 1; index < cutCues.length; index++) {
    if (cutCues[index].frame <= cutCues[index - 1].frame) {
      fail('annotations.cutCues must have strictly increasing frames');
    }
  }
  for (let index = 1; index < sections.length; index++) {
    if (sections[index].startFrame < sections[index - 1].endFrame) {
      fail('annotations.sections must not overlap');
    }
  }
  if (options.requireCoverage) {
    if (sections.length === 0) fail('annotations.sections are required for a render-ready storyboard');
    if (sections[0].startFrame !== 0) fail('annotations.sections must start at frame 0');
    if (sections[sections.length - 1].endFrame !== context.durationInFrames) {
      fail('annotations.sections must end at the project duration');
    }
    for (let index = 1; index < sections.length; index++) {
      if (sections[index].startFrame !== sections[index - 1].endFrame) {
        fail('annotations.sections contain a gap or overlap');
      }
    }
  }
  if (options.requireApproved) {
    if (bpm && bpm.approval !== 'approved') fail('annotations.bpm must be approved');
    if (beatAnchors.some((entry) => entry.approval !== 'approved')) {
      fail('annotations.beatAnchors must all be approved');
    }
    if (cutCues.some((entry) => entry.approval !== 'approved')) {
      fail('annotations.cutCues must all be approved');
    }
    if (sections.some((entry) => entry.approval !== 'approved')) {
      fail('annotations.sections must all be approved');
    }
  }
  return {schemaVersion: 1, projectId: context.projectId, bpm, beatAnchors, cutCues, sections};
};

const parseAspectRatio = (value: string): number => {
  const match = value.match(/^(\d+):(\d+)$/);
  if (!match) fail('creativeBrief.aspectRatio must look like W:H');
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0) || !(height > 0)) fail('creativeBrief.aspectRatio must be positive');
  return width / height;
};

const validatePacing = (value: unknown): CreativeBriefPacing => {
  const pacing = record(value, 'creativeBrief.pacing');
  assertKeys(
    pacing,
    ['preferredShotFrames', 'minShotFrames', 'maxShotFrames', 'allowBeatCuts'],
    'creativeBrief.pacing',
  );
  const result: CreativeBriefPacing = {
    preferredShotFrames: integer(pacing.preferredShotFrames, 'creativeBrief.pacing.preferredShotFrames', 1),
    minShotFrames: integer(pacing.minShotFrames, 'creativeBrief.pacing.minShotFrames', 1),
    maxShotFrames: integer(pacing.maxShotFrames, 'creativeBrief.pacing.maxShotFrames', 1),
    allowBeatCuts: boolean(pacing.allowBeatCuts, 'creativeBrief.pacing.allowBeatCuts'),
  };
  if (result.minShotFrames > result.preferredShotFrames) {
    fail('creativeBrief.pacing.minShotFrames must not exceed preferredShotFrames');
  }
  if (result.preferredShotFrames > result.maxShotFrames) {
    fail('creativeBrief.pacing.maxShotFrames must be at least preferredShotFrames');
  }
  return result;
};

const validateAssetNeed = (value: unknown, index: number): CreativeBriefAssetNeed => {
  const field = `creativeBrief.requiredAssets[${index}]`;
  const item = record(value, field);
  assertKeys(item, ['kind', 'description', 'visualStyle', 'alphaRequired', 'durationFrames', 'continuityReferences'], field);
  const result: CreativeBriefAssetNeed = {
    kind: oneOf(item.kind, ASSET_KINDS, `${field}.kind`),
    description: text(item.description, `${field}.description`),
    alphaRequired: item.alphaRequired === undefined ? false : boolean(item.alphaRequired, `${field}.alphaRequired`),
    continuityReferences: textArray(item.continuityReferences, `${field}.continuityReferences`),
  };
  const visualStyle = optionalText(item.visualStyle, `${field}.visualStyle`);
  if (visualStyle !== undefined) result.visualStyle = visualStyle;
  if (item.durationFrames !== undefined) {
    result.durationFrames = integer(item.durationFrames, `${field}.durationFrames`, 1);
  }
  return result;
};

export const validateCreativeBrief = (
  raw: unknown,
  context: PreproductionContext,
): CreativeBrief => {
  const brief = record(raw, 'creativeBrief');
  assertKeys(
    brief,
    [
      'schemaVersion',
      'projectId',
      'source',
      'approval',
      'concept',
      'narrativeMode',
      'moodProgression',
      'visualStyle',
      'aspectRatio',
      'palette',
      'characters',
      'setting',
      'continuityRules',
      'pacing',
      'cameraLanguage',
      'transitions',
      'approvedReferences',
      'excludedElements',
      'productionConstraints',
      'preferredRenderers',
      'requiredAssets',
      'assumptions',
    ],
    'creativeBrief',
  );
  if (brief.schemaVersion !== 1) fail('creativeBrief.schemaVersion must be 1');
  if (text(brief.projectId, 'creativeBrief.projectId') !== context.projectId) {
    fail(`creativeBrief.projectId must be ${context.projectId}`);
  }
  const aspectRatio = text(brief.aspectRatio, 'creativeBrief.aspectRatio');
  const ratio = parseAspectRatio(aspectRatio);
  const outputRatio = context.width / context.height;
  if (Math.abs(ratio - outputRatio) > 0.01) {
    fail(`creativeBrief.aspectRatio ${aspectRatio} does not match the project output ${context.width}x${context.height}`);
  }
  const approvedReferences = textArray(brief.approvedReferences, 'creativeBrief.approvedReferences', 64);
  const assetsById = new Map(context.assets.map((asset) => [asset.id, asset]));
  for (const assetId of approvedReferences) {
    const asset = assetsById.get(assetId);
    if (!asset) fail(`creativeBrief.approvedReferences references unknown asset ${assetId}`);
    if (asset.approval !== 'approved') {
      fail(`creativeBrief.approvedReferences references unapproved asset ${assetId}`);
    }
  }
  const preferredRenderers = textArray(brief.preferredRenderers, 'creativeBrief.preferredRenderers', 8);
  if (preferredRenderers.length === 0) fail('creativeBrief.preferredRenderers must not be empty');
  for (const renderer of preferredRenderers) {
    if (!context.rendererKinds.has(renderer)) {
      fail(`creativeBrief.preferredRenderers references unregistered renderer ${renderer}`);
    }
  }
  const requiredAssets = (brief.requiredAssets === undefined
    ? []
    : array(brief.requiredAssets, 'creativeBrief.requiredAssets')
  ).map(validateAssetNeed);
  if (requiredAssets.length > 32) fail('creativeBrief.requiredAssets must contain at most 32 entries');

  return {
    schemaVersion: 1,
    projectId: context.projectId,
    source: userSource(brief.source, 'creativeBrief.source'),
    approval: approval(brief.approval, 'creativeBrief.approval'),
    concept: text(brief.concept, 'creativeBrief.concept'),
    narrativeMode: oneOf(brief.narrativeMode, NARRATIVE_MODES, 'creativeBrief.narrativeMode'),
    moodProgression: textArray(brief.moodProgression, 'creativeBrief.moodProgression'),
    visualStyle: text(brief.visualStyle, 'creativeBrief.visualStyle'),
    aspectRatio,
    palette: textArray(brief.palette, 'creativeBrief.palette', 16),
    characters: textArray(brief.characters, 'creativeBrief.characters'),
    setting: text(brief.setting, 'creativeBrief.setting'),
    continuityRules: textArray(brief.continuityRules, 'creativeBrief.continuityRules'),
    pacing: validatePacing(brief.pacing),
    cameraLanguage: textArray(brief.cameraLanguage, 'creativeBrief.cameraLanguage'),
    transitions: textArray(brief.transitions, 'creativeBrief.transitions'),
    approvedReferences,
    excludedElements: textArray(brief.excludedElements, 'creativeBrief.excludedElements'),
    productionConstraints: textArray(brief.productionConstraints, 'creativeBrief.productionConstraints'),
    preferredRenderers,
    requiredAssets,
    assumptions: textArray(brief.assumptions, 'creativeBrief.assumptions'),
  };
};

const validateLyricLine = (
  value: unknown,
  index: number,
  context: PreproductionContext,
  sectionById: Map<string, SectionAnnotation>,
): Omit<LyricLine, 'id' | 'approval' | 'source'> => {
  const field = `lyrics.lines[${index}]`;
  const item = record(value, field);
  assertKeys(item, ['timeSeconds', 'text', 'sectionId'], field);
  const timeSeconds = number(item.timeSeconds, `${field}.timeSeconds`);
  if (timeSeconds < 0) fail(`${field}.timeSeconds must be non-negative`);
  if (timeSeconds > context.durationInFrames / context.fps + 1 / context.fps) {
    fail(`${field}.timeSeconds is beyond the project duration`);
  }
  const frame = Math.round(timeSeconds * context.fps);
  if (frame > context.durationInFrames) fail(`${field} maps beyond the project duration`);
  const lyricText = text(item.text, `${field}.text`);
  const sectionId = optionalText(item.sectionId, `${field}.sectionId`) ?? null;
  if (sectionId !== null) {
    const section = sectionById.get(sectionId);
    if (!section) fail(`${field}.sectionId references unknown section ${sectionId}`);
    if (section.approval !== 'approved') fail(`${field}.sectionId references unapproved section ${sectionId}`);
    if (frame < section.startFrame || frame >= section.endFrame) {
      fail(`${field} lies outside section ${sectionId}`);
    }
  }
  return {timeSeconds, frame, text: lyricText, sectionId};
};

const finalizeLyrics = (
  projectId: string,
  language: string,
  format: 'lrc' | 'json',
  sourcePath: string,
  sourceSha256: string,
  lines: Omit<LyricLine, 'id' | 'approval' | 'source'>[],
  approvalStatus: ApprovalStatus,
  context: PreproductionContext,
): LyricsDocument => {
  const sorted = [...lines].sort((left, right) => left.timeSeconds - right.timeSeconds);
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index].timeSeconds <= sorted[index - 1].timeSeconds) {
      fail('lyrics timestamps must be strictly increasing; overlapping/duplicate lines are not accepted');
    }
  }
  if (sorted.length === 0) fail('lyrics file contains no timed lines');
  if (sorted.length > 512) fail('lyrics contains more than 512 lines');
  const sectionById = new Map((context.sections ?? []).map((section) => [section.id, section]));
  for (const line of sorted) {
    if (line.sectionId && !sectionById.has(line.sectionId)) {
      fail(`lyrics sectionId references unknown section ${line.sectionId}`);
    }
  }
  return {
    schemaVersion: 1,
    projectId,
    language,
    format,
    sourcePath,
    sourceSha256,
    lines: sorted.map((line, index) => ({
      ...line,
      id: `LYRIC-${String(index + 1).padStart(3, '0')}`,
      approval: approvalStatus,
      source: 'user',
    })),
    approval: approvalStatus,
  };
};

const parseLrcTimestamp = (value: string): number => {
  const match = value.match(/^(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$/);
  if (!match) fail(`Invalid LRC timestamp [${value}]`);
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const fraction = match[3] ?? '0';
  const milliseconds = Number(fraction.padEnd(3, '0'));
  if (seconds >= 60 || milliseconds >= 1000) fail(`Invalid LRC timestamp [${value}]`);
  return minutes * 60 + seconds + milliseconds / 1000;
};

export const parseLrcLyrics = (input: {
  text: string;
  language: string;
  sourcePath: string;
  sourceSha256: string;
  approval: ApprovalStatus;
  context: PreproductionContext;
}): LyricsDocument => {
  const lines: Omit<LyricLine, 'id' | 'approval' | 'source'>[] = [];
  let offsetSeconds = 0;
  for (const rawLine of input.text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    const offset = line.match(/^\[offset:([+-]?\d+)\]$/i);
    if (offset) {
      offsetSeconds = Number(offset[1]) / 1000;
      continue;
    }
    if (/^\[(ti|ar|al|by|la|length):/i.test(line)) continue;
    const timestamps: number[] = [];
    let cursor = 0;
    const timestampPattern = /\[([0-9]{1,3}:[0-9]{2}(?:[.:][0-9]{1,3})?)\]/g;
    let match: RegExpExecArray | null;
    while ((match = timestampPattern.exec(line)) !== null) {
      if (match.index !== cursor) break;
      timestamps.push(parseLrcTimestamp(match[1]));
      cursor = timestampPattern.lastIndex;
    }
    if (timestamps.length === 0) {
      fail(`LRC line has no timestamp: ${line}`);
    }
    const lyricText = line.slice(cursor).trim();
    if (lyricText === '') fail(`LRC line has empty text: ${line}`);
    for (const timestamp of timestamps) {
      const timeSeconds = timestamp + offsetSeconds;
      if (timeSeconds < 0) fail('LRC offset moves a timestamp before zero');
      const frame = Math.round(timeSeconds * input.context.fps);
      if (frame > input.context.durationInFrames) fail('LRC timestamp is beyond the project duration');
      lines.push({timeSeconds, frame, text: lyricText, sectionId: null});
    }
  }
  return finalizeLyrics(
    input.context.projectId,
    input.language,
    'lrc',
    input.sourcePath,
    input.sourceSha256,
    lines,
    input.approval,
    input.context,
  );
};

export const validateJsonLyrics = (input: {
  raw: unknown;
  language: string;
  sourcePath: string;
  sourceSha256: string;
  context: PreproductionContext;
}): LyricsDocument => {
  const document = record(input.raw, 'lyrics');
  assertKeys(document, ['schemaVersion', 'language', 'format', 'approval', 'lines'], 'lyrics');
  if (document.schemaVersion !== 1) fail('lyrics.schemaVersion must be 1');
  if (document.format !== 'json') fail('lyrics.format must be "json" for a structured lyrics file');
  const language = text(document.language, 'lyrics.language');
  const approvalStatus = approval(document.approval, 'lyrics.approval');
  const sectionById = new Map((input.context.sections ?? []).map((section) => [section.id, section]));
  const rawLines = array(document.lines, 'lyrics.lines');
  const lines = rawLines.map((line, index) =>
    validateLyricLine(line, index, input.context, sectionById),
  );
  return finalizeLyrics(
    input.context.projectId,
    language || input.language,
    'json',
    input.sourcePath,
    input.sourceSha256,
    lines,
    approvalStatus,
    input.context,
  );
};

export const validateBeatGridReport = (
  raw: unknown,
  context: {projectId: string; fps: number; durationInFrames: number; sourceSha256: string},
): BeatGridReport => {
  const report = record(raw, 'beatGrid');
  if (report.schemaVersion !== 1) fail('beatGrid.schemaVersion must be 1');
  if (report.projectId !== context.projectId) fail(`beatGrid.projectId must be ${context.projectId}`);
  if (report.algorithmVersion !== BEAT_GRID_ALGORITHM_VERSION) {
    fail(`beatGrid.algorithmVersion must be ${BEAT_GRID_ALGORITHM_VERSION}`);
  }
  if (report.sourceSha256 !== context.sourceSha256) fail('beatGrid source hash does not match the master audio');
  if (report.outputFps !== context.fps) fail('beatGrid outputFps does not match the project');
  if (report.durationFrames !== context.durationInFrames) fail('beatGrid durationFrames does not match the project');
  const events = array(report.beatEvents, 'beatGrid.beatEvents');
  let previous = -1;
  for (const [index, value] of events.entries()) {
    const event = record(value, `beatGrid.beatEvents[${index}]`);
    const frame = integer(event.frame, `beatGrid.beatEvents[${index}].frame`);
    if (frame < 0 || frame >= context.durationInFrames) {
      fail(`beatGrid.beatEvents[${index}].frame is outside the project`);
    }
    if (frame <= previous) fail('beatGrid.beatEvents must be strictly increasing by frame');
    previous = frame;
    if (event.source !== 'estimated' || event.classification !== 'estimated') {
      fail('beatGrid beat events must remain estimated candidates');
    }
  }
  return report as unknown as BeatGridReport;
};

export const requirementIds = (requirements: readonly AssetRequirement[]): Set<string> =>
  new Set(requirements.map((requirement) => requirement.id));

const sameNumbers = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const sameText = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/**
 * Re-validate a recorded beat-grid approval against the beat grid that is
 * currently on disk. Any reanalysis that changes the estimate invalidates the
 * approval, so an estimated candidate can only reach director timing through a
 * review that still matches the measured evidence.
 */
export const validateApprovedBeatGrid = (
  raw: unknown,
  context: {
    projectId: string;
    fps: number;
    durationInFrames: number;
    sourceSha256: string;
    beatGridPath: string;
  },
  report: BeatGridReport | null,
): ApprovedBeatGrid => {
  const document = record(raw, 'approvedBeatGrid');
  assertKeys(document, ['schemaVersion', 'projectId', 'status', 'source', 'selected'], 'approvedBeatGrid');
  if (document.schemaVersion !== 1) fail('approvedBeatGrid.schemaVersion must be 1');
  if (text(document.projectId, 'approvedBeatGrid.projectId') !== context.projectId) {
    fail(`approvedBeatGrid.projectId must be ${context.projectId}`);
  }
  if (document.status !== 'approved') {
    fail('approvedBeatGrid.status must be "approved"; an unapproved candidate cannot drive director timing');
  }
  if (!report) {
    fail('approvedBeatGrid refers to a beat grid that is missing; run analyze-beats and re-approve');
  }
  if (!report.estimatedTempo) {
    fail('The current beat grid has insufficient rhythmic evidence and cannot be approved as timing');
  }
  if (report.evidence.tempoChangeSuspected) {
    fail('The current beat grid suspects a tempo change; a constant-tempo approval is not valid');
  }
  const source = record(document.source, 'approvedBeatGrid.source');
  assertKeys(
    source,
    [
      'beatGridPath',
      'algorithmVersion',
      'sourceSha256',
      'candidateBpm',
      'confidence',
      'quality',
      'ambiguity',
      'candidateBeatFrames',
      'candidateBeatIds',
    ],
    'approvedBeatGrid.source',
  );
  if (text(source.beatGridPath, 'approvedBeatGrid.source.beatGridPath') !== context.beatGridPath) {
    fail(`approvedBeatGrid.source.beatGridPath must be ${context.beatGridPath}`);
  }
  if (source.algorithmVersion !== report.algorithmVersion) {
    fail('approvedBeatGrid was made from a different beat-grid algorithm version; re-analyze and re-approve');
  }
  if (source.sourceSha256 !== report.sourceSha256 || source.sourceSha256 !== context.sourceSha256) {
    fail('approvedBeatGrid source audio hash does not match the current master audio and beat grid');
  }
  const candidateBpm = number(source.candidateBpm, 'approvedBeatGrid.source.candidateBpm');
  if (candidateBpm !== report.estimatedTempo.bpm) {
    fail('approvedBeatGrid candidate BPM does not match the current beat grid; the approval is stale');
  }
  const confidence = number(source.confidence, 'approvedBeatGrid.source.confidence');
  if (confidence !== report.estimatedTempo.confidence) {
    fail('approvedBeatGrid confidence does not match the current beat grid; the approval is stale');
  }
  if (oneOf(source.quality, ['high', 'medium', 'low', 'insufficient'], 'approvedBeatGrid.source.quality') !== report.estimatedTempo.quality) {
    fail('approvedBeatGrid quality does not match the current beat grid; the approval is stale');
  }
  const ambiguity = record(source.ambiguity, 'approvedBeatGrid.source.ambiguity');
  assertKeys(ambiguity, ['halfTempo', 'doubleTempo', 'offbeatOnsets', 'notes'], 'approvedBeatGrid.source.ambiguity');
  const halfTempo = boolean(ambiguity.halfTempo, 'approvedBeatGrid.source.ambiguity.halfTempo');
  const doubleTempo = boolean(ambiguity.doubleTempo, 'approvedBeatGrid.source.ambiguity.doubleTempo');
  if (halfTempo !== report.estimatedTempo.ambiguity.halfTempo || doubleTempo !== report.estimatedTempo.ambiguity.doubleTempo) {
    fail('approvedBeatGrid ambiguity flags do not match the current beat grid');
  }
  if (integer(ambiguity.offbeatOnsets, 'approvedBeatGrid.source.ambiguity.offbeatOnsets') !== report.estimatedTempo.ambiguity.offbeatOnsets) {
    fail('approvedBeatGrid offbeat transient count does not match the current beat grid');
  }
  const candidateFrames = array(source.candidateBeatFrames, 'approvedBeatGrid.source.candidateBeatFrames').map(
    (value, index) => integer(value, `approvedBeatGrid.source.candidateBeatFrames[${index}]`),
  );
  const reportFrames = report.beatEvents.map((event) => event.frame);
  if (!sameNumbers(candidateFrames, reportFrames)) {
    fail('approvedBeatGrid candidate beat frames do not match the current beat grid; the approval is stale');
  }
  const candidateIds = array(source.candidateBeatIds, 'approvedBeatGrid.source.candidateBeatIds').map(
    (value, index) => text(value, `approvedBeatGrid.source.candidateBeatIds[${index}]`),
  );
  if (!sameText(candidateIds, report.beatEvents.map((event) => event.id))) {
    fail('approvedBeatGrid candidate beat ids do not match the current beat grid; the approval is stale');
  }

  const selected = record(document.selected, 'approvedBeatGrid.selected');
  assertKeys(
    selected,
    ['bpm', 'interpretation', 'ambiguityAcknowledged', 'selectedBy', 'beatFrames', 'beatIds', 'reviewNotes', 'approvalRevision'],
    'approvedBeatGrid.selected',
  );
  const interpretation = oneOf(
    selected.interpretation,
    BEAT_INTERPRETATIONS,
    'approvedBeatGrid.selected.interpretation',
  );
  if ((halfTempo || doubleTempo) && !boolean(selected.ambiguityAcknowledged, 'approvedBeatGrid.selected.ambiguityAcknowledged')) {
    fail('The approved beat grid must acknowledge the reported competing tempo interpretations');
  }
  if (interpretation === 'half-tempo' && !halfTempo) {
    fail('A half-tempo approval requires a competing half-tempo candidate in the beat grid');
  }
  const expectedBpm = interpretation === 'as-estimated' ? candidateBpm : candidateBpm / 2;
  const selectedBpm = number(selected.bpm, 'approvedBeatGrid.selected.bpm');
  if (Math.abs(selectedBpm - expectedBpm) > expectedBpm * 0.01) {
    fail(`approvedBeatGrid.selected.bpm must match the ${interpretation} interpretation of ${candidateBpm} BPM`);
  }
  const expectedFrames = interpretation === 'as-estimated'
    ? reportFrames
    : reportFrames.filter((_, index) => index % 2 === 0);
  const expectedIds = interpretation === 'as-estimated'
    ? report.beatEvents.map((event) => event.id)
    : report.beatEvents.filter((_, index) => index % 2 === 0).map((event) => event.id);
  if (expectedFrames.length < 1) fail('The approved beat interpretation produced no beats');
  const beatFrames = array(selected.beatFrames, 'approvedBeatGrid.selected.beatFrames').map(
    (value, index) => integer(value, `approvedBeatGrid.selected.beatFrames[${index}]`),
  );
  if (beatFrames.length > 512) fail('approvedBeatGrid.selected.beatFrames must contain at most 512 entries');
  for (const [index, frame] of beatFrames.entries()) {
    if (frame >= context.durationInFrames) {
      fail(`approvedBeatGrid.selected.beatFrames[${index}] is outside the project duration`);
    }
  }
  if (!sameNumbers(beatFrames, expectedFrames)) {
    fail('approvedBeatGrid.selected.beatFrames must be the beats measured by the approved interpretation');
  }
  const beatIds = array(selected.beatIds, 'approvedBeatGrid.selected.beatIds').map(
    (value, index) => text(value, `approvedBeatGrid.selected.beatIds[${index}]`),
  );
  if (!sameText(beatIds, expectedIds)) {
    fail('approvedBeatGrid.selected.beatIds must reference the candidate beat ids of the approved interpretation');
  }
  if (selected.selectedBy !== 'user') fail('approvedBeatGrid.selected.selectedBy must be "user"');
  const reviewNotes = text(selected.reviewNotes, 'approvedBeatGrid.selected.reviewNotes');
  const approvalRevision = integer(selected.approvalRevision, 'approvedBeatGrid.selected.approvalRevision', 1);
  return {
    schemaVersion: 1,
    projectId: context.projectId,
    status: 'approved',
    source: {
      beatGridPath: context.beatGridPath,
      algorithmVersion: report.algorithmVersion,
      sourceSha256: String(report.sourceSha256),
      candidateBpm,
      confidence,
      quality: report.estimatedTempo.quality,
      ambiguity: {
        halfTempo,
        doubleTempo,
        offbeatOnsets: report.estimatedTempo.ambiguity.offbeatOnsets,
        notes: textArray(ambiguity.notes, 'approvedBeatGrid.source.ambiguity.notes'),
      },
      candidateBeatFrames: candidateFrames,
      candidateBeatIds: candidateIds,
    },
    selected: {
      bpm: selectedBpm,
      interpretation,
      ambiguityAcknowledged: Boolean(selected.ambiguityAcknowledged),
      selectedBy: 'user',
      beatFrames,
      beatIds,
      reviewNotes,
      approvalRevision,
    },
  };
};
