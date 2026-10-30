export type DurationPolicy = 'round' | 'floor' | 'ceil';

export type AudioConfig = {
  path: string;
  sha256: string;
  durationSeconds: number;
  durationPolicy: DurationPolicy;
  format: 'wav-pcm';
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

export type VisualConfig = {
  styleProfile: string;
  defaultRenderer: string;
  pixel?: PixelProfile;
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
};

export type Shot = {
  id: string;
  startFrame: number;
  endFrame: number;
  renderer: string;
  params: SceneParams;
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
  render: RenderConfig;
  audio: {
    durationSeconds: number;
    sha256: string;
    durationPolicy: DurationPolicy;
  };
  assets: RenderProjectAsset[];
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
  renderProject: RenderProjectSnapshot;
};
