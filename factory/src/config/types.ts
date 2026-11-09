export type DurationPolicy = 'round' | 'floor' | 'ceil';
export type AudioFormat = 'wav-pcm' | 'mp3' | 'flac' | 'm4a-aac';
export type AudioMixSampleRate = 44100 | 48000;

export type AudioConfig = {
  path: string;
  sha256: string;
  durationSeconds: number;
  durationPolicy: DurationPolicy;
  format: AudioFormat;
  assetId?: string;
  mixSampleRate: AudioMixSampleRate;
  gainDb: number;
  fadeInFrames: number;
  fadeOutFrames: number;
  gainAutomation: AudioAutomationPoint[];
};

export type AudioTrackRole = 'sfx' | 'voiceover' | 'ambience';

export type AudioAutomationPoint = {
  frame: number;
  gainDb: number;
};

export type AudioTrackConfig = {
  id: string;
  role: AudioTrackRole;
  assetId: string;
  startFrame: number;
  durationFrames: number;
  sourceStartSeconds: number;
  gainDb: number;
  fadeInFrames: number;
  fadeOutFrames: number;
  muted: boolean;
  gainAutomation: AudioAutomationPoint[];
};

export type AudioAssetMetadata = {
  format: AudioFormat;
  container: string;
  codec: string;
  sampleRate: number;
  channels: number;
  channelLayout: string | null;
  probeDurationSeconds: number;
  decodedDurationSeconds: number;
  startTimeSeconds: number;
  encoderDelaySamples: number | null;
  paddingSamples: number | null;
  hasUnexpectedStreams: boolean;
  fileSizeBytes: number;
};

export type LyricsConfig = {
  language: string;
  path: string | null;
};

export type NarrativeMode = 'narrative' | 'abstract' | 'lyric' | 'hybrid';

export type NarrativeConfig = {
  mode: NarrativeMode;
};

export type PixelProfile = {
  internalWidth: number;
  internalHeight: number;
  samplingFps: number;
};

export type VisualStyleSelection = {
  id: string;
  theme?: string;
  note?: string;
};

export type VisualConfig = {
  styleProfile: string;
  defaultRenderer: string;
  pixel?: PixelProfile;
  style?: VisualStyleSelection;
};

export type OutputConfig = {
  width: number;
  height: number;
  fps: number;
  durationInFrames?: number;
  aspectRatio?: string;
};

export type CueSource = 'measured' | 'estimated' | 'synthetic';

export type Cue = {
  id: string;
  frame: number;
  timeSeconds: number;
  source: CueSource;
  label: string;
};

export type SceneParams = {
  background?: string;
  accent?: string;
  secondary?: string;
  assetId?: string;
  bars?: number;
  motion?: number;
  label?: string;
  /**
   * Optional image-overlay controls for the layered-canvas renderer. Omitting
   * them keeps the historical defaults exactly (0.18 / 0.55 / 0.22 / 0.6 / 0.08).
   * Each value is a 0-1 alpha or opacity.
   */
  washTop?: number;
  washBottom?: number;
  overlayOpacity?: number;
  lineOpacity?: number;
  grainOpacity?: number;
};

export type MediaFit = 'contain' | 'cover';
export type VideoEndBehavior = 'reject';

export type VideoSourceConfig = {
  assetId: string;
  sourceStartSeconds: number;
  fit: MediaFit;
  endBehavior: VideoEndBehavior;
  muted: true;
  positionX: number;
  positionY: number;
  scale: number;
};

export type ShotVideoMedia = VideoSourceConfig & {
  kind: 'video';
};

export type HybridLayerConfig = {
  assetId: string;
  order: number;
  opacity: number;
  fit: MediaFit;
  positionX: number;
  positionY: number;
  scale: number;
  visibleFromFrame: number;
  visibleToFrame: number;
};

export type HybridOverlayKind = 'rain' | 'orbits' | 'scan';

export type HybridOverlayConfig = {
  kind: HybridOverlayKind;
  intensity: number;
  color?: string;
};

export type ShotHybridMedia = {
  kind: 'hybrid';
  video: VideoSourceConfig;
  layers: HybridLayerConfig[];
  overlay: HybridOverlayConfig;
};

export type ParallaxLayerRole = 'midground' | 'subject' | 'foreground';

export type LayerMotionConfig = {
  translateXFrom: number;
  translateXTo: number;
  translateYFrom: number;
  translateYTo: number;
  fromFrame?: number;
  toFrame?: number;
  easing: 'linear' | 'easeInOut';
};

/**
 * A depth layer. `parallax` is the fraction of the camera displacement this
 * layer follows; the compositor multiplies the camera offset by it, so two
 * layers with different values always move by different amounts.
 */
export type ParallaxLayerConfig = {
  assetId: string;
  role: ParallaxLayerRole;
  order: number;
  parallax: number;
  opacity: number;
  fit: MediaFit;
  positionX: number;
  positionY: number;
  scale: number;
  /** Optional depth-of-field blur in output pixels; 0 keeps the plate sharp. */
  blur?: number;
  visibleFromFrame: number;
  visibleToFrame: number;
  motion?: LayerMotionConfig;
};

/**
 * One authored pose state of an approved character. Poses tile the shot-local
 * clock exactly, so a character can never freeze on a stale drawing or show two
 * contradictory poses at the same frame.
 */
export type ParallaxPoseKeyframe = {
  /** Approved `layer` asset holding one full-body or bust pose. */
  assetId: string;
  /** Inclusive shot-local start frame. */
  fromFrame: number;
  /** Exclusive shot-local end frame. */
  toFrame: number;
  /** `cut` swaps on a single frame; `crossfade` blends over `fadeFrames`. */
  transition: 'cut' | 'crossfade';
  /** 0 for a cut, 2-12 output frames for a crossfade. */
  fadeFrames: number;
  /** Blocking offset as a fraction of output frame width/height. */
  offsetX: number;
  offsetY: number;
  scale: number;
  opacity: number;
};

/** Frame-derived idle motion. It never feeds the camera path. */
export type ParallaxCharacterIdleConfig = {
  amplitude: number;
  periodFrames: number;
};

/**
 * An approved character performing inside a 2.5D shot. The pose sequence is the
 * performance; `breathe` and `sway` are idle life, not acting. Both are sampled
 * from the integer output frame, so the same frame always renders identically.
 */
export type ParallaxCharacterConfig = {
  characterId: string;
  role: 'subject';
  /** Draw order shared with `layers`; larger draws nearer the camera. */
  order: number;
  parallax: number;
  /** Normalized screen position of the character's pivot point. */
  anchorX: number;
  anchorY: number;
  /** Normalized pivot inside the pose artwork (feet for full body, neck for bust). */
  pivotX: number;
  pivotY: number;
  /** Rendered artwork height as a fraction of output frame height. */
  height: number;
  breathe?: ParallaxCharacterIdleConfig;
  sway?: ParallaxCharacterIdleConfig;
  poses: ParallaxPoseKeyframe[];
};

export type ParallaxImageBackground = {
  kind: 'image';
  assetId: string;
  opacity: number;
  fit: MediaFit;
  positionX: number;
  positionY: number;
  scale: number;
  parallax: number;
  blur?: number;
};

export type ParallaxVideoBackground = VideoSourceConfig & {
  kind: 'video';
  opacity: number;
  parallax: number;
  blur?: number;
};

export type ParallaxBackgroundConfig = ParallaxImageBackground | ParallaxVideoBackground;

export type CameraMoveKind = 'pan' | 'push-in' | 'pull-back' | 'hold';

/**
 * Normalized camera path. x/y are fractions of the output frame and zoom is a
 * multiplier starting at 1. The renderer samples this once per output frame.
 */
export type CameraMoveConfig = {
  kind: CameraMoveKind;
  fromX: number;
  fromY: number;
  fromZoom: number;
  toX: number;
  toY: number;
  toZoom: number;
  easing: 'linear' | 'easeInOut';
};

export type AtmosphereKind = 'rain' | 'mist' | 'rain-mist' | 'none';

export type AtmosphereConfig = {
  kind: AtmosphereKind;
  intensity: number;
  windX: number;
};

export type LightSweepConfig = {
  intensity: number;
  fromX: number;
  toX: number;
  width: number;
  color?: string;
};

export type LightVariationConfig = {
  amplitude: number;
  frequency: number;
  phase: number;
  sweep?: LightSweepConfig;
};

export type GradeConfig = {
  saturation: number;
  contrast: number;
  brightness: number;
  tint: string;
  tintOpacity: number;
  vignette: number;
  grain: number;
};

export type ComicImpactFrame = {
  frame: number;
  intensity: number;
  color?: string;
};

export type ComicPanelWipe = {
  frame: number;
  direction: 'left' | 'right' | 'up' | 'down';
  color?: string;
  holdFrames: number;
};

export type ComicTreatmentConfig = {
  motionStepFps: number;
  halftone: number;
  speedLines: number;
  panel: {gutter: number; color: string; inset: number} | null;
  impacts: ComicImpactFrame[];
  wipes: ComicPanelWipe[];
};

/**
 * Asset-backed 2.5D shot. The background is one opaque plate; every other
 * depth tier is an RGBA layer, so an opaque image can never masquerade as a
 * transparent cutout.
 */
export type ShotParallaxMedia = {
  kind: 'parallax-2p5d';
  background: ParallaxBackgroundConfig;
  layers: ParallaxLayerConfig[];
  /** Optional authored character performance; absent keeps the legacy shot. */
  characters?: ParallaxCharacterConfig[];
  camera: CameraMoveConfig;
  atmosphere: AtmosphereConfig;
  light: LightVariationConfig;
  grade?: Partial<GradeConfig>;
  comic?: Partial<ComicTreatmentConfig>;
};

export type ShotMediaConfig = ShotVideoMedia | ShotHybridMedia | ShotParallaxMedia;

export type VideoAssetMetadata = {
  assetId: string;
  container: string;
  codec: 'h264';
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  hasAudio: boolean;
  pixelFormat: string | null;
  rotation: number;
};

export type Shot = {
  id: string;
  startFrame: number;
  endFrame: number;
  renderer: string;
  params: SceneParams;
  moduleParams?: SceneModuleParams;
  media?: ShotMediaConfig;
};

export type Chapter = {
  id: string;
  title: string;
  startFrame: number;
  endFrame: number;
  shots: Shot[];
};

export type ProjectAssetKind = 'image' | 'video' | 'layer' | 'audio-reference';
export type AssetApproval = 'approved' | 'pending' | 'rejected' | 'not_present';

export type ProjectSceneModuleType = 'canvas2d';
export type SceneModuleTrust = 'user-authored-approved';
export type SceneModuleCanvasConfig =
  | {mode: 'output'}
  | {mode: 'project-pixel'}
  | {mode: 'custom'; width: number; height: number};
export type SceneModuleSampling = number | 'output' | 'project-pixel';
export type SceneModuleParams = Record<string, string | number | boolean>;

export type SceneModuleConfig = {
  id: string;
  path: string;
  moduleType: ProjectSceneModuleType;
  contractVersion: 1;
  sha256: string;
  trust: SceneModuleTrust;
  canvas: SceneModuleCanvasConfig;
  samplingFps: SceneModuleSampling;
  pixelated: boolean;
  label?: string;
  description?: string;
  /** Registered visual styles this module implements. Omitted for legacy modules. */
  styleIds?: string[];
};

export type RenderProjectSceneModule = Pick<
  SceneModuleConfig,
  'id' | 'contractVersion' | 'moduleType' | 'sha256'
>;

export type ProjectAsset = {
  id: string;
  kind: ProjectAssetKind;
  path: string;
  sha256: string;
  source: string;
  rights: string;
  approval: AssetApproval;
};

export type PermissionsConfig = {
  externalGeneration: boolean;
  localOnly: boolean;
  allowNetwork: boolean;
};

export type RenderConfig = {
  codec: 'h264';
  pixelFormat: 'yuv420p';
  colorSpace: 'bt709';
  imageFormat: 'png' | 'jpeg';
};

export type ProjectConfig = {
  schemaVersion: 1;
  projectId: string;
  song: {title: string; artist: string};
  audio: AudioConfig;
  lyrics: LyricsConfig;
  narrative: NarrativeConfig;
  visual: VisualConfig;
  output: OutputConfig;
  cues: Cue[];
  chapters: Chapter[];
  sceneModules: SceneModuleConfig[];
  audioTracks: AudioTrackConfig[];
  assets: ProjectAsset[];
  permissions: PermissionsConfig;
  render: RenderConfig;
};

export type RenderProjectCue = Cue;

export type RenderProjectAsset = {
  id: string;
  kind: ProjectAssetKind;
  sha256: string;
  approval: AssetApproval;
};

export type RenderProjectShot = Shot & {
  chapterId: string;
  chapterTitle: string;
};

export type RenderProjectChapter = {
  id: string;
  title: string;
  startFrame: number;
  endFrame: number;
  shots: RenderProjectShot[];
};

export type RenderProjectSnapshot = {
  projectId: string;
  song: {title: string; artist: string};
  output: {
    width: number;
    height: number;
    fps: number;
    durationInFrames: number;
  };
  visual: VisualConfig;
  narrative: NarrativeConfig;
  cues: RenderProjectCue[];
  chapters: RenderProjectChapter[];
  sceneModules: RenderProjectSceneModule[];
  render: RenderConfig;
  audio: {
    durationSeconds: number;
    sha256: string;
    durationPolicy: DurationPolicy;
    format: AudioFormat;
    mixSampleRate: AudioMixSampleRate;
    gainDb: number;
    fadeInFrames: number;
    fadeOutFrames: number;
    gainAutomation: AudioAutomationPoint[];
  };
  assets: RenderProjectAsset[];
  mediaAssets: Record<string, VideoAssetMetadata>;
  publicAssets: Record<string, string>;
  audioPublicPath?: string;
};

export type ResolvedShot = {
  shot: Shot;
  chapterId: string;
  chapterTitle: string;
  index: number;
};

export type LoadedAsset = ProjectAsset & {
  absolutePath: string | null;
  hashVerified: boolean;
  videoMetadata?: VideoAssetMetadata;
  audioMetadata?: AudioAssetMetadata;
  /** Present only when a project uses the asset-backed 2.5D route. */
  imageMetadata?: {
    width: number;
    height: number;
    bitDepth: number;
    colorType: number;
    hasAlpha: boolean;
  };
};

export type LoadedSceneModule = SceneModuleConfig & {
  absolutePath: string;
  computedSha256: string;
  sourceText: string;
  sourceBytes: Uint8Array;
};

export type LoadedProject = {
  config: ProjectConfig;
  workspaceRoot: string;
  projectDir: string;
  audioPath: string;
  audioDurationSeconds: number;
  durationInFrames: number;
  shots: ResolvedShot[];
  assets: LoadedAsset[];
  sceneModules: LoadedSceneModule[];
  audioMetadata?: AudioAssetMetadata;
  audioTracks: AudioTrackConfig[];
  renderProject: RenderProjectSnapshot;
};
