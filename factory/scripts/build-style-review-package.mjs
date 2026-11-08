// Builds the P1-G-B human review package from actual decoded output.
//
// Extracts real frames from the rendered MP4 files, builds contact sheets with
// labels, records decoded technical QC, per-shot motion descriptions, asset
// provenance, honest limitations and an empty artistic checklist. The verdict
// stays PENDING_HUMAN_REVIEW; this script never invents an approval.
//
// Usage:
//   node factory/scripts/build-style-review-package.mjs --workspace <root>
//     [--projects cinematic-2p5d-tram-stop,anime-motion-comic-tram-stop]
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const workspaceRoot = arg('workspace', process.env.MV_WORKSPACE_ROOT);
const projectIds = arg('projects', 'cinematic-2p5d-tram-stop,anime-motion-comic-tram-stop')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
if (!workspaceRoot) {
  console.error('--workspace is required');
  process.exit(2);
}

const reviewRoot = path.join(workspaceRoot, 'review-package');
const compareDir = path.join(reviewRoot, 'compare');
mkdirSync(compareDir, {recursive: true});

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const rel = (file) => path.relative(workspaceRoot, file).split(path.sep).join('/');

const REPRESENTATIVE = [
  {frame: 8, label: 'A establishing'},
  {frame: 60, label: 'A tram approach'},
  {frame: 120, label: 'B realisation'},
  {frame: 240, label: 'C separation'},
  {frame: 330, label: 'D aftermath'},
];
const SHOT_BOUNDARIES = [0, 96, 192, 288];

const ffprobeJson = (file) =>
  JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
      {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true},
    ),
  );

const extractFrame = (video, frame, output) => {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      video,
      '-vf',
      `select=eq(n\\,${frame})`,
      '-fps_mode',
      'passthrough',
      '-frames:v',
      '1',
      output,
    ],
    {encoding: 'utf8', windowsHide: true},
  );
};

const fontFile = existsSync('C:/Windows/Fonts/arial.ttf')
  ? 'C\\:/Windows/Fonts/arial.ttf'
  : existsSync('C:/Windows/Fonts/segoeui.ttf')
    ? 'C\\:/Windows/Fonts/segoeui.ttf'
    : null;

const contactSheet = (tiles, output, columns, labelPrefix) => {
  const inputArgs = tiles.flatMap((tile) => ['-i', tile.file]);
  const filters = [];
  for (const [index, tile] of tiles.entries()) {
    const label = `${labelPrefix}${tile.label}`.replace(/[':]/g, '');
    const text = fontFile
      ? `,drawtext=fontfile='${fontFile}':text='${label}':x=10:y=h-28:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4`
      : '';
    filters.push(`[${index}:v]scale=384:216${text}[v${index}]`);
  }
  const rows = Math.ceil(tiles.length / columns);
  for (let row = 0; row < rows; row += 1) {
    const members = Array.from({length: columns}, (_, column) => `[v${row * columns + column}]`).join('');
    filters.push(`${members}hstack=inputs=${columns}[r${row}]`);
  }
  const rowMembers = Array.from({length: rows}, (_, row) => `[r${row}]`).join('');
  if (rows === 1) filters.push('[r0]null[out]');
  else filters.push(`${rowMembers}vstack=inputs=${rows}[out]`);
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      ...inputArgs,
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[out]',
      '-frames:v',
      '1',
      output,
    ],
    {encoding: 'utf8', windowsHide: true},
  );
};

const shotMotion = (shot) => {
  if (!shot.media) return 'No media.';
  const camera = shot.media.camera;
  const kindText = {
    pan: 'lateral pan',
    'push-in': 'push in',
    'pull-back': 'pull back',
    hold: 'locked camera',
  }[camera.kind];
  const layerText = shot.media.layers
    .map((layer) => {
      const parts = [`${layer.role} depth ${layer.parallax}`];
      if (layer.motion) {
        parts.push(
          `translates ${layer.motion.translateXFrom} to ${layer.motion.translateXTo} of frame width`,
        );
      }
      if (layer.blur) parts.push(`blur ${layer.blur}px`);
      return parts.join(', ');
    })
    .join('; ');
  const comic = shot.media.comic
    ? ` Comic treatment: ${shot.media.comic.motionStepFps}fps stepped motion, halftone ${shot.media.comic.halftone}, speed lines ${shot.media.comic.speedLines}, ${shot.media.comic.impacts?.length ?? 0} impact frames, ${shot.media.comic.wipes?.length ?? 0} panel wipes.`
    : '';
  return `${kindText} from (${camera.fromX}, ${camera.fromY}) zoom ${camera.fromZoom} to (${camera.toX}, ${camera.toY}) zoom ${camera.toZoom}. Layers: ${layerText}.${comic}`;
};

const projectReview = (projectId) => {
  const projectDir = path.join(workspaceRoot, projectId);
  const configFile = path.join(projectDir, 'project.json');
  if (!existsSync(configFile)) throw new Error(`Missing project.json for ${projectId}`);
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const mp4 = path.join(projectDir, 'renders', `${projectId}-render.mp4`);
  if (!existsSync(mp4)) throw new Error(`Missing rendered MP4 for ${projectId}`);

  const outDir = path.join(reviewRoot, projectId);
  mkdirSync(outDir, {recursive: true});
  const copyPath = path.join(outDir, `${projectId}.mp4`);
  copyFileSync(mp4, copyPath);

  const frames = REPRESENTATIVE.map((entry) => {
    const file = path.join(outDir, `frame-${String(entry.frame).padStart(3, '0')}.png`);
    extractFrame(mp4, entry.frame, file);
    return {...entry, file};
  });
  const boundaries = SHOT_BOUNDARIES.map((frame) => {
    const file = path.join(outDir, `boundary-${String(frame).padStart(3, '0')}.png`);
    extractFrame(mp4, frame, file);
    return {frame, label: `shot boundary ${frame}`, file};
  });

  const sheet = path.join(outDir, 'contact-sheet.png');
  contactSheet(
    frames.map((entry) => ({file: entry.file, label: `${entry.frame} ${entry.label}`})),
    sheet,
    5,
    `${projectId} `,
  );

  const probe = ffprobeJson(copyPath);
  const videoStream = probe.streams.find((stream) => stream.codec_type === 'video');
  const audioStreams = probe.streams.filter((stream) => stream.codec_type === 'audio');

  const provenance = existsSync(path.join(projectDir, 'reports', 'asset-provenance.json'))
    ? JSON.parse(readFileSync(path.join(projectDir, 'reports', 'asset-provenance.json'), 'utf8'))
    : null;
  const renderRecord = existsSync(
    path.join(projectDir, 'reports', `render-${projectId}-video.json`),
  )
    ? JSON.parse(
        readFileSync(path.join(projectDir, 'reports', `render-${projectId}-video.json`), 'utf8'),
      )
    : null;

  return {
    projectId,
    style: config.visual.style?.id ?? null,
    outDir,
    copyPath,
    sheet,
    frames,
    boundaries,
    probe,
    videoStream,
    audioStreams,
    config,
    provenance,
    renderRecord,
  };
};

const reviews = projectIds.map(projectReview);

// Cross-style comparison sheet.
const compareTiles = reviews.flatMap((review) =>
  review.frames.map((entry) => ({file: entry.file, label: `${review.style} ${entry.frame}`})),
);
const compareSheet = path.join(compareDir, 'cross-style-contact-sheet.png');
contactSheet(compareTiles, compareSheet, 5, '');

// One frame per shot, both prototypes: the full-shot montage used alongside the final report.
const SHOT_COLUMNS = [
  {key: 'A', frame: 60, range: '0-96'},
  {key: 'B', frame: 120, range: '96-192'},
  {key: 'C', frame: 240, range: '192-288'},
  {key: 'D', frame: 330, range: '288-360'},
];
const montageTiles = reviews.flatMap((review) =>
  SHOT_COLUMNS.map((column) => {
    const frame = review.frames.find((entry) => entry.frame === column.frame);
    if (!frame) throw new Error(`Missing representative frame ${column.frame} for ${review.projectId}`);
    return {
      file: frame.file,
      label: `${review.style} · shot ${column.key} (${column.range})`,
    };
  }),
);
const montageSheet = path.join(compareDir, 'all-shots-montage.png');
contactSheet(montageTiles, montageSheet, 4, '');

const mdLines = [];
mdLines.push('# P1-G-B — Human review package: cinematic 2.5D and anime motion comic');
mdLines.push('');
mdLines.push('Status: `PENDING_HUMAN_REVIEW`');
mdLines.push('');
mdLines.push(
  'This package is local evidence. It is not the engineering acceptance report and it does not claim artistic approval.',
);
mdLines.push('');
mdLines.push('## What to review, in order');
mdLines.push('');
mdLines.push('1. Watch both short MP4 files end to end.');
mdLines.push('2. Look at the cross-style contact sheet and decide whether the two languages are genuinely different.');
mdLines.push('3. Read the per-shot motion notes and the limitations.');
mdLines.push('4. Fill the artistic checklist at the bottom; the verdict is yours.');
mdLines.push('');
mdLines.push('## Files');
mdLines.push('');
for (const review of reviews) {
  mdLines.push(`### ${review.style}`);
  mdLines.push('');
  mdLines.push(`- Short film: \`${rel(review.copyPath)}\``);
  mdLines.push(`- Five decoded frames: \`${rel(review.outDir)}/frame-*.png\``);
  mdLines.push(`- Shot-boundary stills: \`${rel(review.outDir)}/boundary-*.png\``);
  mdLines.push(`- Contact sheet: \`${rel(review.sheet)}\``);
  mdLines.push('');
}
mdLines.push(`- Cross-style comparison: \`${rel(compareSheet)}\``);
mdLines.push(`- Full-shot montage, one frame per shot per prototype: \`${rel(montageSheet)}\``);
mdLines.push('');

mdLines.push('## Decoded technical QC');
mdLines.push('');
mdLines.push('| Project | Codec | Size | FPS | Frames | Pixel format | Audio streams | Duration |');
mdLines.push('|---|---|---|---|---|---|---|---|');
for (const review of reviews) {
  const v = review.videoStream;
  mdLines.push(
    `| ${review.projectId} | ${v.codec_name} | ${v.width}x${v.height} | ${v.r_frame_rate} | ${v.nb_frames} | ${v.pix_fmt} | ${review.audioStreams.length} | ${Number(probeDuration(review.probe))}s |`,
  );
}
mdLines.push('');

mdLines.push('## Shot motion');
mdLines.push('');
for (const review of reviews) {
  mdLines.push(`### ${review.style}`);
  mdLines.push('');
  for (const shot of review.config.chapters[0].shots) {
    mdLines.push(
      `- **${shot.id}** (frames ${shot.startFrame}-${shot.endFrame}): ${shotMotion(shot)}`,
    );
  }
  mdLines.push('');
}

mdLines.push('## Asset provenance');
mdLines.push('');
mdLines.push(
  'All artwork and audio in these prototypes is original and generated offline by this repository. No download, no paid provider, no private media, no real actor likeness.',
);
mdLines.push('');
mdLines.push('| Asset | Kind | SHA256 | Source |');
mdLines.push('|---|---|---|---|');
for (const review of reviews) {
  for (const asset of review.config.assets) {
    mdLines.push(
      `| ${asset.id} | ${asset.kind} | \`${asset.sha256}\` | ${asset.source} |`,
    );
  }
}
mdLines.push('');

mdLines.push('## Honest aesthetic limitations');
mdLines.push('');
mdLines.push(
  '- Characters are procedural vector illustrations, not painted portraits or photographed performers.',
);
mdLines.push(
  '- The 2.5D route is layered cardboard parallax with authored depth of field; it is not volumetric 3D, not a mesh and not a real camera.',
);
mdLines.push(
  '- Anime characters are cutouts driven by stepped holds and graphic overlays; this is a motion comic, not full character animation or lip-sync.',
);
mdLines.push(
  '- Rain, mist and light sweeps are simulated deterministically; they are not physically simulated fluids or ray-traced light.',
);
mdLines.push(
  '- The tram is a graphic cutout with a moving transform; it does not deform, carry motion blur or interact with the ground.',
);
mdLines.push(
  '- Expression changes are limited to what the supplied portrait contains; there are no generated in-between drawings.',
);
mdLines.push('');

mdLines.push('## Character continuity notes');
mdLines.push('');
mdLines.push(
  '- The woman keeps the cream coat, red scarf, dark bob and umbrella across every cinematic shot; the portrait plate reuses the same palette and hair mass.',
);
mdLines.push(
  '- The man keeps the olive jacket, dark trousers and dark hair; he is deliberately taller than the woman in every shot.',
);
mdLines.push(
  '- The anime versions keep the same costume colours but use comic proportions, thicker ink and a larger eye-to-face ratio.',
);
mdLines.push(
  '- Continuity risk: the full-figure and chest-up plates are separate drawings, so the exact face proportions differ slightly between shot A and shot B.',
);
mdLines.push('');

mdLines.push('## Artistic review checklist');
mdLines.push('');
mdLines.push('Mark each criterion for both prototypes. Nothing here is pre-filled.');
mdLines.push('');
mdLines.push(
  '| # | Criterion | Cinematic 2.5D | Anime motion comic |',
);
mdLines.push('|---|---|---|---|');
const criteria = [
  'Subject readability',
  'Character proportions',
  'Scene depth',
  'Foreground occlusion',
  'Camera motion',
  'Expressive action',
  'Lighting consistency',
  'Colour quality',
  'Background richness',
  'Visual continuity',
  'Shot composition',
  'Emotional communication',
];
for (const [index, criterion] of criteria.entries()) {
  mdLines.push(`| ${index + 1} | ${criterion} | ☐ pass ☐ fail | ☐ pass ☐ fail |`);
}
mdLines.push('');
mdLines.push('Overall artistic verdict (creator): ☐ accept  ☐ revise  ☐ reject');
mdLines.push('');
mdLines.push('Reviewer notes:');
mdLines.push('');
mdLines.push('```');
mdLines.push('');
mdLines.push('```');
mdLines.push('');

writeFileSync(path.join(reviewRoot, 'review.md'), `${mdLines.join('\n')}\n`);

const machine = {
  schemaVersion: 1,
  generatedBy: 'factory/scripts/build-style-review-package.mjs',
  verdict: 'PENDING_HUMAN_REVIEW',
  compareSheet: {
    path: rel(compareSheet),
    sha256: sha256(compareSheet),
  },
  montageSheet: {
    path: rel(montageSheet),
    sha256: sha256(montageSheet),
  },
  projects: reviews.map((review) => ({
    projectId: review.projectId,
    style: review.style,
    file: rel(review.copyPath),
    sha256: sha256(review.copyPath),
    frames: review.frames.map((entry) => ({
      frame: entry.frame,
      label: entry.label,
      path: rel(entry.file),
      sha256: sha256(entry.file),
    })),
    boundaries: review.boundaries.map((entry) => ({
      frame: entry.frame,
      path: rel(entry.file),
      sha256: sha256(entry.file),
    })),
    contactSheet: {path: rel(review.sheet), sha256: sha256(review.sheet)},
    video: {
      codec: review.videoStream.codec_name,
      width: review.videoStream.width,
      height: review.videoStream.height,
      fps: review.videoStream.r_frame_rate,
      frames: Number(review.videoStream.nb_frames),
      pixelFormat: review.videoStream.pix_fmt,
      audioStreams: review.audioStreams.length,
      audioCodec: review.audioStreams[0]?.codec_name ?? null,
      durationSeconds: Number(review.probe.format?.duration ?? 0),
    },
    renderFingerprint: review.renderRecord?.fingerprint?.hash ?? null,
    assets: review.config.assets.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      sha256: entry.sha256,
    })),
  })),
};
writeFileSync(path.join(reviewRoot, 'review.json'), `${JSON.stringify(machine, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      workspace: workspaceRoot,
      review: path.join(reviewRoot, 'review.md'),
      machine: path.join(reviewRoot, 'review.json'),
      compareSheet,
      verdict: 'PENDING_HUMAN_REVIEW',
    },
    null,
    2,
  ),
);

function probeDuration(probe) {
  return probe.format?.duration ?? probe.streams?.find((s) => s.codec_type === 'video')?.duration ?? 0;
}
