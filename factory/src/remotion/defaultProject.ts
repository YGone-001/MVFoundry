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
      renderer: 'layered-canvas',
      params: {
        background: '#07101c',
        accent: '#2f6474',
        secondary: '#e29a4a',
        motion: 1.2,
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
      renderer: 'layered-canvas',
      params: {
        background: '#141014',
        accent: '#4a2630',
        secondary: '#d97757',
        motion: 1.6,
      },
    },
  ],
};

export const DEFAULT_RENDER_PROJECT: RenderProjectSnapshot = {
  projectId: 'mv-factory-demo',
  song: {title: 'MV Factory Demo', artist: 'Factory'},
  output: {width: 1920, height: 1080, fps: 24, durationInFrames: 48},
  visual: {
    // The default Remotion composition is a non-pixel, full-resolution
    // layered-canvas abstract so a fresh checkout is not mistaken for a
    // pixel-art-only engine. Pixel art remains available as one style among six.
    styleProfile: 'layered-abstract',
    defaultRenderer: 'layered-canvas',
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
