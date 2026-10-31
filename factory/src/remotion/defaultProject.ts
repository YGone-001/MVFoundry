import type {RenderProjectChapter, RenderProjectSnapshot} from '../config/types';

const chapterA: RenderProjectChapter = {
  id: 'CH-01',
  title: 'Demo A',
  startFrame: 0,
  endFrame: 24,
  shots: [
    {
      id: 'SHOT-01',
      chapterId: 'CH-01',
      chapterTitle: 'Demo A',
      startFrame: 0,
      endFrame: 24,
      renderer: 'pixel-canvas',
      params: {
        background: '#0B1B2B',
        accent: '#2EC4B6',
        secondary: '#FF9F1C',
        bars: 7,
        motion: 2.5,
      },
    },
  ],
};

const chapterB: RenderProjectChapter = {
  id: 'CH-02',
  title: 'Demo B',
  startFrame: 24,
  endFrame: 48,
  shots: [
    {
      id: 'SHOT-02',
      chapterId: 'CH-02',
      chapterTitle: 'Demo B',
      startFrame: 24,
      endFrame: 48,
      renderer: 'pixel-canvas',
      params: {
        background: '#123044',
        accent: '#FF9F1C',
        secondary: '#E9E3D2',
        bars: 5,
        motion: 4,
      },
    },
  ],
};

export const DEFAULT_RENDER_PROJECT: RenderProjectSnapshot = {
  projectId: 'mv-factory-demo',
  song: {title: 'MV Factory Demo', artist: 'Factory'},
  output: {width: 1920, height: 1080, fps: 24, durationInFrames: 48},
  visual: {
    styleProfile: 'pixel-art',
    defaultRenderer: 'pixel-canvas',
    pixel: {internalWidth: 480, internalHeight: 270, samplingFps: 12},
  },
  narrative: {mode: 'abstract'},
  cues: [
    {id: 'CUE-01', frame: 0, timeSeconds: 0, source: 'synthetic', label: 'start'},
    {id: 'CUE-02', frame: 24, timeSeconds: 1, source: 'synthetic', label: 'mid'},
    {id: 'CUE-03', frame: 48, timeSeconds: 2, source: 'synthetic', label: 'end'},
  ],
  chapters: [chapterA, chapterB],
  sceneModules: [],
  render: {
    codec: 'h264',
    pixelFormat: 'yuv420p',
    colorSpace: 'bt709',
    imageFormat: 'png',
  },
  audio: {
    durationSeconds: 2,
    sha256: '0'.repeat(64),
    durationPolicy: 'round',
    format: 'wav-pcm',
    mixSampleRate: 48000,
    gainDb: 0,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    gainAutomation: [],
  },
  assets: [],
  mediaAssets: {},
  publicAssets: {},
};
