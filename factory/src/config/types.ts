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

export type ShotMediaConfig = ShotVideoMedia | ShotHybridMedia;

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
