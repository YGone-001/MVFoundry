import type {
  AtmosphereConfig,
  CameraMoveConfig,
  HybridOverlayKind,
  LightVariationConfig,
  MediaFit,
  ProjectAssetKind,
  SceneParams,
} from '../config/types';

export const PREPRODUCTION_SCHEMA_VERSION = 1;
export const BEAT_GRID_ALGORITHM_VERSION = 'beat-grid-v1';
export const DIRECTOR_ALGORITHM_VERSION = 'director-v1';

export type ApprovalStatus = 'draft' | 'proposed' | 'approved' | 'rejected';
export type SourceKind = 'user' | 'estimated' | 'synthetic' | 'measured';
export type BeatQuality = 'high' | 'medium' | 'low' | 'insufficient';
export type TempoRelation = 'none' | 'half' | 'double' | 'other';

/**
 * A reviewer may only approve a grid the analyzer actually measured. A denser
 * grid than the reported beats would have to be invented, so finer timing uses
 * approved manual beat anchors instead.
 */
export type BeatGridInterpretation = 'as-estimated' | 'half-tempo';

export type TempoCandidate = {
  bpm: number;
  lagHops: number;
  periodicity: number;
  harmonicScore: number;
  score: number;
  relation: TempoRelation;
};

export type BeatGridAmbiguity = {
  halfTempo: boolean;
  doubleTempo: boolean;
  offbeatOnsets: number;
  notes: string[];
};

export type BeatEvent = {
  id: string;
  timeSeconds: number;
  frame: number;
  strength: number;
  source: 'estimated';
  classification: 'estimated';
  confidence: number | null;
};

export type ApprovedBeatGrid = {
  schemaVersion: 1;
  projectId: string;
  status: 'approved';
  source: {
    beatGridPath: string;
    algorithmVersion: string;
    sourceSha256: string;
    candidateBpm: number;
    confidence: number;
    quality: BeatQuality;
    ambiguity: BeatGridAmbiguity;
    candidateBeatFrames: number[];
    candidateBeatIds: string[];
  };
  selected: {
    bpm: number;
    interpretation: BeatGridInterpretation;
    ambiguityAcknowledged: boolean;
    selectedBy: 'user';
    beatFrames: number[];
    beatIds: string[];
    reviewNotes: string;
    approvalRevision: number;
  };
};

export type BeatGridReport = {
  schemaVersion: 1;
  projectId: string;
  algorithmVersion: typeof BEAT_GRID_ALGORITHM_VERSION;
  sourceSha256: string;
  sampleRate: number;
  outputFps: number;
  durationFrames: number;
  parameters: {
    frameSize: number;
    hopSize: number;
    minBpm: number;
    maxBpm: number;
    bpmStep: number;
    onsetThreshold: number;
  };
  onsetStrength: {
    frameCount: number;
    mean: number;
    max: number;
    activeFrames: number;
  };
  tempoCandidates: TempoCandidate[];
  estimatedTempo: {
    bpm: number;
    confidence: number;
    quality: BeatQuality;
    ambiguity: BeatGridAmbiguity;
  } | null;
  phase: {
    offsetHops: number;
    offsetSeconds: number;
    score: number;
    contrast: number;
  } | null;
  beatEvents: BeatEvent[];
  evidence: {
    onsetCount: number;
    beatCount: number;
    meanIntervalFrames: number;
    intervalJitterFrames: number;
    tempoChangeSuspected: boolean;
  };
  limitations: string[];
  status: 'estimated';
  approval: 'unapproved';
};

export type ManualBpm = {
  value: number;
  source: 'user';
  approval: ApprovalStatus;
  notes?: string;
};

export type ManualBeatAnchor = {
  id: string;
  frame: number;
  timeSeconds: number;
  source: 'user';
  approval: ApprovalStatus;
  notes?: string;
};

export type ManualCutCue = {
  id: string;
  frame: number;
  timeSeconds: number;
  label: string;
  source: 'user';
  approval: ApprovalStatus;
  notes?: string;
};

export type SectionAnnotation = {
  id: string;
  label: string;
  startFrame: number;
  endFrame: number;
  source: 'user';
  approval: ApprovalStatus;
  notes?: string;
};

export type AnnotationDocument = {
  schemaVersion: 1;
  projectId: string;
  bpm: ManualBpm | null;
  beatAnchors: ManualBeatAnchor[];
  cutCues: ManualCutCue[];
  sections: SectionAnnotation[];
};

export type LyricLine = {
  id: string;
  timeSeconds: number;
  frame: number;
  text: string;
  sectionId: string | null;
  approval: ApprovalStatus;
  source: 'user';
};

export type LyricsDocument = {
  schemaVersion: 1;
  projectId: string;
  language: string;
  format: 'lrc' | 'json';
  sourcePath: string;
  sourceSha256: string;
  lines: LyricLine[];
  approval: ApprovalStatus;
};

export type CreativeBriefPacing = {
  preferredShotFrames: number;
  minShotFrames: number;
  maxShotFrames: number;
  allowBeatCuts: boolean;
};

export type CreativeBriefAssetNeed = {
  kind: 'image' | 'video' | 'layer' | 'scene-module' | 'existing-asset';
  description: string;
  visualStyle?: string;
  alphaRequired?: boolean;
  durationFrames?: number;
  continuityReferences?: string[];
};

/**
 * Planned media is intent, not configuration. It names the requirement slots
 * that must be fulfilled before a real asset ID exists, and reuses the accepted
 * P1-C media vocabulary so the compiler never needs a second media schema. The
 * shape is flat and identical in the brief, the plan and the storyboard.
 */
export type PlannedMediaBase = {
  backgroundSlot: string;
  sourceStartFrames: number;
  fit: MediaFit;
  positionX: number;
  positionY: number;
  scale: number;
};

export type PlannedHybridLayer = {
  slot: string;
  order: number;
  opacity: number;
  fit: MediaFit;
  positionX: number;
  positionY: number;
  scale: number;
  visibleFromFrame: number;
  visibleToFrame: number;
};

export type PlannedHybridOverlay = {
  kind: HybridOverlayKind;
  intensity: number;
  color: string | null;
};

export type PlannedShotMedia =
  | (PlannedMediaBase & {kind: 'video'})
  | (PlannedMediaBase & {kind: 'hybrid'; layers: PlannedHybridLayer[]; overlay: PlannedHybridOverlay})
  | PlannedParallaxMedia;

/* -------------------------------------------------------------------------- */
/* Planned 2.5D shot                                                           */
/* -------------------------------------------------------------------------- */

export type PlannedParallaxRole = 'midground' | 'subject' | 'foreground';

export type PlannedLayerMotion = {
  translateXFrom: number;
  translateXTo: number;
  translateYFrom: number;
  translateYTo: number;
  fromFrame?: number;
  toFrame?: number;
  easing: 'linear' | 'easeInOut';
};

/** One static depth layer. `slot` is the requirement this plate must satisfy. */
export type PlannedParallaxLayer = {
  slot: string;
  role: PlannedParallaxRole;
  order: number;
  parallax: number;
  opacity: number;
  fit: MediaFit;
  positionX: number;
  positionY: number;
  scale: number;
  blur?: number;
  visibleFromFrame: number;
  visibleToFrame: number;
  motion?: PlannedLayerMotion;
};

/** One authored pose state. Each pose names its own requirement slot. */
export type PlannedParallaxPose = {
  slot: string;
  fromFrame: number;
  toFrame: number;
  transition: 'cut' | 'crossfade';
  fadeFrames: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  opacity: number;
};

export type PlannedParallaxCharacter = {
  characterId: string;
  order: number;
  parallax: number;
  anchorX: number;
  anchorY: number;
  pivotX: number;
  pivotY: number;
  height: number;
  breathe?: {amplitude: number; periodFrames: number};
  sway?: {amplitude: number; periodFrames: number};
  poses: PlannedParallaxPose[];
};

/**
 * A planned asset-backed 2.5D shot. It is intent, not configuration: every slot
 * must be fulfilled by an approved local asset before the compiler emits real
 * `ShotParallaxMedia`, and the shot-local frame bounds are re-checked then.
 */
export type PlannedParallaxMedia = {
  kind: 'parallax-2p5d';
  backgroundSlot: string;
  background: {
    parallax: number;
    opacity: number;
    fit: MediaFit;
    positionX: number;
    positionY: number;
    scale: number;
    blur?: number;
  };
  camera: CameraMoveConfig;
  atmosphere: AtmosphereConfig;
  light: LightVariationConfig;
  layers: PlannedParallaxLayer[];
  characters: PlannedParallaxCharacter[];
};

export type CreativeBriefRendererDirective = {
  id: string;
  renderer: string;
  continuityIds: string[];
  media: PlannedShotMedia | null;
};

export type CreativeBrief = {
  schemaVersion: 1;
  projectId: string;
  source: 'user';
  approval: ApprovalStatus;
  concept: string;
  narrativeMode: 'narrative' | 'abstract' | 'lyric' | 'hybrid';
  moodProgression: string[];
  visualStyle: string;
  aspectRatio: string;
  palette: string[];
  characters: string[];
  setting: string;
  continuityRules: string[];
  pacing: CreativeBriefPacing;
  cameraLanguage: string[];
  transitions: string[];
  approvedReferences: string[];
  excludedElements: string[];
  productionConstraints: string[];
  preferredRenderers: string[];
  rendererDirectives: CreativeBriefRendererDirective[];
  requiredAssets: CreativeBriefAssetNeed[];
  assumptions: string[];
};

export type AssetRequirementKind =
  | 'image'
  | 'video'
  | 'layer'
  | 'scene-module'
  | 'existing-asset';

export type AssetRequirementStatus =
  | 'needed'
  | 'in-production'
  | 'available'
  | 'approved'
  | 'rejected';

export type AssetRequirement = {
  id: string;
  shotIds: string[];
  kind: AssetRequirementKind;
  description: string;
  visualStyle: string;
  aspectRatio: string;
  durationFrames: number | null;
  alphaRequired: boolean;
  continuityReferences: string[];
  provenanceRequirements: string;
  renderer: string;
  status: AssetRequirementStatus;
  approval: ApprovalStatus;
  fulfilledAssetId: string | null;
  path: string | null;
  sha256: string | null;
  mediaSlot: string | null;
  fingerprint: string;
};

export type PlanTimingSource =
  | 'manual-bpm'
  | 'manual-beat'
  | 'manual-cut'
  | 'section'
  | 'approved-beat-grid'
  | 'project-cue'
  | 'lyric';

export type PlanShot = {
  id: string;
  chapterId: string;
  startFrame: number;
  endFrame: number;
  purpose: string;
  visualDescription: string;
  renderer: string;
  rendererParams: SceneParams;
  camera: string;
  movement: string;
  colorAndLighting: string;
  characterReferences: string[];
  environmentReference: string;
  timingRationale: string;
  timingSource: PlanTimingSource;
  sourceFrame: number | null;
  cueId: string | null;
  assetRequirementIds: string[];
  continuityReferences: string[];
  continuityIds: string[];
  media: PlannedShotMedia | null;
  reviewStatus: ApprovalStatus;
  assumptions: string[];
};

export type PlanChapter = {
  id: string;
  title: string;
  label: string;
  sectionId: string | null;
  startFrame: number;
  endFrame: number;
  shots: PlanShot[];
};

export type DirectorPlan = {
  schemaVersion: 1;
  projectId: string;
  revision: number;
  algorithmVersion: typeof DIRECTOR_ALGORITHM_VERSION;
  status: ApprovalStatus;
  source: {
    audioSha256: string;
    durationFrames: number;
    fps: number;
    beatGridUsed: boolean;
    approvedBeatGridUsed: boolean;
    approvedBeatGrid: {
      bpm: number;
      interpretation: BeatGridInterpretation;
      confidence: number;
      quality: BeatQuality;
      approvalRevision: number;
      candidateBeatIds: string[];
      selectedBeatIds: string[];
    } | null;
    beatConfidence: number | null;
    manualTimingUsed: boolean;
    lyricLineCount: number;
  };
  brief: {
    concept: string;
    visualStyle: string;
    aspectRatio: string;
    moodProgression: string[];
    assumptions: string[];
  };
  chapters: PlanChapter[];
  assetRequirements: AssetRequirement[];
  timingNotes: string[];
  reviewNotes: string[];
};

export type StoryboardShot = PlanShot & {
  cueIds: string[];
  cutCueIds: string[];
  lyricLineIds: string[];
  missingAssetRequirements: string[];
  rendererReady: boolean;
};

export type StoryboardChapter = Omit<PlanChapter, 'shots'> & {
  shots: StoryboardShot[];
};

export type Storyboard = {
  schemaVersion: 1;
  projectId: string;
  revision: number;
  planRevision: number;
  status: ApprovalStatus;
  source: {
    audioSha256: string;
    durationFrames: number;
    fps: number;
    beatGridUsed: boolean;
    manualTimingUsed: boolean;
  };
  chapters: StoryboardChapter[];
  assetRequirements: AssetRequirement[];
  renderReady: boolean;
  missingAssetRequirements: string[];
  timingNotes: string[];
  reviewNotes: string[];
};

export type CompileReport = {
  schemaVersion: 1;
  projectId: string;
  storyboardRevision: number;
  status: 'ready' | 'blocked';
  candidatePath: string | null;
  missingAssetRequirements: string[];
  validation: 'passed' | 'not-run';
  notes: string[];
};

export type MissingAssetsReport = {
  schemaVersion: 1;
  projectId: string;
  storyboardRevision: number;
  status: 'blocked';
  missingAssetRequirements: string[];
  requirements: AssetRequirement[];
  notes: string[];
};

export type AssetRequirementsManifest = {
  schemaVersion: 1;
  projectId: string;
  storyboardRevision: number;
  renderReady: boolean;
  requirements: AssetRequirement[];
  missingAssetRequirements: string[];
  notes: string[];
};

export const CONTINUITY_SCHEMA_VERSION = 1;
export const PRODUCTION_TASK_SCHEMA_VERSION = 1;
export const ASSET_INTAKE_SCHEMA_VERSION = 1;

export type ContinuityKind =
  | 'character'
  | 'location'
  | 'appearance'
  | 'prop'
  | 'style'
  | 'palette'
  | 'lighting'
  | 'camera';

export type ContinuityEntry = {
  id: string;
  identity: string;
  kind: ContinuityKind;
  description: string;
  shotIds: string[];
  referenceAssetId: string | null;
  attributes: Record<string, string>;
  constraints: string[];
  exclusions: string[];
  approval: ApprovalStatus;
  revision: number;
  supersedes: string | null;
};

export type ContinuityDocument = {
  schemaVersion: typeof CONTINUITY_SCHEMA_VERSION;
  projectId: string;
  revision: number;
  entries: ContinuityEntry[];
};

export type ContinuityFinding = {
  code:
    | 'unknown-reference'
    | 'unapproved-reference'
    | 'contradictory-attributes'
    | 'undeclared-appearance-change'
    | 'missing-reference-asset'
    | 'shot-declaration-mismatch'
    | 'unknown-asset';
  continuityId: string;
  shotIds: string[];
  message: string;
};

export type ProductionTaskStatus =
  | 'needed'
  | 'in-production'
  | 'delivered'
  | 'under-review'
  | 'approved'
  | 'rejected';

export type ProductionTask = {
  id: string;
  requirementId: string;
  shotIds: string[];
  renderer: string;
  assetKind: AssetRequirementKind;
  mediaSlot: string | null;
  brief: string;
  visualStyle: string;
  targetWidth: number | null;
  targetHeight: number | null;
  aspectRatio: string;
  targetDurationFrames: number | null;
  alphaRequired: boolean;
  continuityIds: string[];
  approvedReferenceIds: string[];
  provenanceRequirements: string;
  acceptanceCriteria: string[];
  productionStatus: ProductionTaskStatus;
  reviewStatus: ApprovalStatus;
  fulfilledAssetId: string | null;
  path: string | null;
  sha256: string | null;
  revision: number;
};

export type ProductionTaskManifest = {
  schemaVersion: typeof PRODUCTION_TASK_SCHEMA_VERSION;
  projectId: string;
  storyboardRevision: number;
  tasks: ProductionTask[];
  unapprovedContinuityReferences: string[];
  notes: string[];
};

export type AssetIntakeReview = 'pending' | 'in-review' | 'approved' | 'rejected';

export type AssetIntakeRecord = {
  requirementId: string;
  assetId: string;
  kind: ProjectAssetKind;
  path: string;
  sha256: string;
  fileSizeBytes: number;
  fingerprint: string;
  provenance: string;
  rights: string;
  review: AssetIntakeReview;
  reviewNotes: string | null;
  recordedAtStoryboardRevision: number;
  technical: {
    probed: 'video' | 'layer' | 'image' | 'audio' | 'unprobed';
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    fps: number | null;
    hasAlpha: boolean | null;
    codec: string | null;
  };
};

export type AssetIntakeDocument = {
  schemaVersion: typeof ASSET_INTAKE_SCHEMA_VERSION;
  projectId: string;
  records: AssetIntakeRecord[];
};

export type StaleFulfillment = {
  requirementId: string;
  assetId: string;
  reason: string;
};