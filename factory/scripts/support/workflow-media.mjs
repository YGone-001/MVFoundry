import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {hash, refuse} from './workflow-state.mjs';
const require = createRequire(import.meta.url);
const {parsePcm16WavBuffer} = require('../../dist/src/media/wav.js');
export function runMedia(command, args) {
  const r = spawnSync(command, args, {windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: 20 * 60 * 1000});
  if (r.status !== 0) refuse('MEDIA_PROCESS_FAILED', `${command} exit=${r.status} signal=${r.signal}: ${String(r.stderr).slice(-4000)}`);
  return r.stdout;
}
// Decode the delivered MP4 and compare its PCM to the actual frame-range mix.
export function inspectPreview(output, {width, height, fps, start, end, mixPath, sampleRate}) {
  const probe = JSON.parse(runMedia('ffprobe', ['-v','error','-show_streams','-show_format','-of','json',output]));
  const videos = probe.streams.filter((s) => s.codec_type === 'video');
  const audios = probe.streams.filter((s) => s.codec_type === 'audio');
  const v = videos[0];
  if (videos.length !== 1 || !v || v.codec_name !== 'h264' || v.pix_fmt !== 'yuv420p' || v.width !== width || v.height !== height || v.r_frame_rate !== `${fps}/1` || Number(v.nb_frames) !== end-start) refuse('PREVIEW_VIDEO_INVALID', 'Preview dimensions, fps, codec or frame count disagree with the selected range');
  const frames = runMedia('ffmpeg', ['-v','error','-i',output,'-map','0:v:0','-vf','scale=16:16','-f','rawvideo','-pix_fmt','rgb24','pipe:1']);
  if (frames.length !== (end-start)*16*16*3) refuse('DECODED_FRAMES_MISSING', 'Decoded preview frame count is incomplete');
  if (audios.length !== 1 || audios[0].codec_name !== 'aac') refuse('DECODED_AUDIO_MISSING', 'Expected exactly one AAC soundtrack');
  const pcm = runMedia('ffmpeg', ['-v','error','-i',output,'-map','0:a:0','-f','s16le','-ac','2','-ar',String(sampleRate),'pipe:1']);
  const mix = parsePcm16WavBuffer(readFileSync(mixPath), 'authoritative mix');
  const first = Math.round(start*sampleRate/fps), count = Math.round(end*sampleRate/fps)-first;
  if (mix.sampleRate !== sampleRate || mix.channels !== 2 || mix.frameCount < first+count || count <= 0) refuse('MIX_INTERVAL_MISSING', 'The authoritative PCM mix does not cover this interval at its declared sample rate');
  if (pcm.length/4 < count-1024 || pcm.length/4 > count+2048) refuse('DECODED_AUDIO_MISSING', 'Decoded audio does not cover selected range');
  let aa=0,bb=0,ab=0,error=0;
  for (let i=0; i<Math.min(count,pcm.length/4); i++) {
    const a=mix.samples[(first+i)*2], b=pcm.readInt16LE(i*4)/32768;
    aa+=a*a; bb+=b*b; ab+=a*b; error+=(a-b)**2;
  }
  const correlation = aa*bb === 0 ? (aa === bb ? 1 : 0) : ab/Math.sqrt(aa*bb);
  const rmsError = Math.sqrt(error/count);
  if (!Number.isFinite(correlation) || !Number.isFinite(rmsError) || correlation < .95 || rmsError > .04) refuse('AUDIO_SLICE_MISMATCH', `Decoded audio does not match mix interval [${start},${end}): correlation=${correlation} rmsError=${rmsError}`);
  return {video: {width,height,fps,frames:end-start,decodedFrames:frames.length/768}, audio:{streams:1,sampleRate,expectedSamples:count,decodedSamples:pcm.length/4,sourceStartSample:first,correlation,rmsError,referenceRms:Math.sqrt(aa/count),decodedRms:Math.sqrt(bb/count)}, decodedFrameDigest:hash(frames)};
}
