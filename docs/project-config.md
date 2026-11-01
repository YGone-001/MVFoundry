# Project Configuration Contract

Each local music-video project is a directory under `MV_WORKSPACE_ROOT`:

```
<MV_WORKSPACE_ROOT>/<projectId>/
  project.json
  source/audio/...
  source/lyrics/...
  source/rights/...
  analysis/
  writing/
  visual/
  assets/images/
  assets/video/
  assets/layers/
  scenes/
  cache/
  renders/
  reports/
```

The folder name must equal `projectId`. The loader reads only `project.json` and manifest-declared files.

## 1. Top-level schema

```json
{
  "schemaVersion": 1,
  "projectId": "synthetic-pixel-demo",
  "song": {"title": "...", "artist": "..."},
  "audio": {
    "path": "source/audio/tone.wav",
    "sha256": "64 lowercase hex chars",
    "durationSeconds": 2,
    "durationPolicy": "round",
    "format": "wav-pcm",
    "assetId": "AUDIO-MUSIC",
    "mixSampleRate": 48000,
    "gainDb": 0,
    "fadeInFrames": 0,
    "fadeOutFrames": 0,
    "gainAutomation": []
  },
  "lyrics": {"language": "none", "path": null},
  "narrative": {"mode": "abstract"},
  "visual": {
    "styleProfile": "pixel-art",
    "defaultRenderer": "pixel-canvas",
    "pixel": {"internalWidth": 480, "internalHeight": 270, "samplingFps": 12}
  },
  "output": {"width": 1920, "height": 1080, "fps": 24},
  "cues": [{"id": "CUE-01", "frame": 0, "timeSeconds": 0, "source": "synthetic", "label": "start"}],
  "chapters": [
    {
      "id": "CH-01",
      "title": "First chapter",
      "startFrame": 0,
      "endFrame": 24,
      "shots": [
        {
          "id": "SHOT-01",
          "startFrame": 0,
          "endFrame": 24,
          "renderer": "pixel-canvas",
          "params": {"background": "#0B1B2B", "accent": "#2EC4B6", "bars": 7, "motion": 2.5}
        }
      ]
    }
  ],
  "audioTracks": [
    {
      "id": "rain-ambience",
      "role": "ambience",
      "assetId": "AUDIO-RAIN",
      "startFrame": 72,
      "durationFrames": 96,
      "sourceStartSeconds": 0,
      "gainDb": -15,
      "fadeInFrames": 8,
      "fadeOutFrames": 8,
      "muted": false,
      "gainAutomation": []
    }
  ],
  "sceneModules": [
    {
      "id": "runner",
      "path": "scenes/runner.ts",
      "moduleType": "canvas2d",
      "contractVersion": 1,
      "sha256": "64 lowercase hex chars",
      "trust": "user-authored-approved",
      "canvas": {"mode": "project-pixel"},
      "samplingFps": "project-pixel",
      "pixelated": true
    }
  ],
  "assets": [
    {
      "id": "AUDIO-MUSIC",
      "kind": "audio-reference",
      "path": "source/audio/tone.wav",
      "sha256": "64 lowercase hex chars",
      "source": "Local synthetic fixture",
      "rights": "Synthetic; no third-party rights",
      "approval": "approved"
    },
    {
      "id": "BG-01",
      "kind": "image",
      "path": "assets/images/bg.png",
      "sha256": "64 lowercase hex chars",
      "source": "Local synthetic fixture",
      "rights": "Synthetic; no third-party rights",
      "approval": "approved"
    }
  ],
  "permissions": {"externalGeneration": false, "localOnly": true, "allowNetwork": false},
  "render": {"codec": "h264", "pixelFormat": "yuv420p", "colorSpace": "bt709", "imageFormat": "png"}
}
```

## 2. Field rules

| Area | Rule |
|---|---|
| `schemaVersion` | exactly `1` |
| `projectId` | lowercase letters/digits/hyphens, 3-64 chars, equals folder name |
| `audio.path` | project-relative, no absolute path, no `..` |
| `audio.sha256` | lowercase 64-char hash; verified at load |
| `audio.durationSeconds` | positive; must match decoded duration within 0.02 s (WAV) or `max(0.05 s, 1/fps)` (MP3/FLAC/M4A) |
| `audio.durationPolicy` | `round`, `floor` or `ceil`; remains the frame-duration authority |
| `audio.format` | `wav-pcm`, `mp3`, `flac` or `m4a-aac`; actual content is probed, extensions are not trusted |
| `audio.assetId` | optional; if present must be an approved `audio-reference` asset with the same path and SHA256 |
| `audio.mixSampleRate` | `44100` or `48000`; defaults to `48000` |
| `audio.gainDb` | finite dB in `[-60, 12]`; applied to the whole master |
| `audio.fadeInFrames`, `audio.fadeOutFrames` | non-negative integer frames; their sum must not exceed the project duration |
| `audio.gainAutomation` | optional array (max 32) of `{frame, gainDb}` with strictly increasing project frames, bounded dB, and no frame beyond the project duration |
| `audioTracks` | optional array (max 32); see §5 |
| `output.width/height/fps` | positive integers; fps <= 120 |
| `output.durationInFrames` | optional; if present must equal the audio-derived duration |
| `cues[].frame` | integer in `[0, duration]`; `timeSeconds` must agree within half a frame |
| `cues[].source` | `measured`, `estimated` or `synthetic` |
| chapter/shot frames | integers, `startFrame < endFrame`, chapters cover `[0, duration)` exactly, shots cover each chapter exactly |
| `renderer` | must be registered in the scene registry; `project:<id>` must reference a declared scene module |
| `params.assetId` | must reference an existing `approved` asset; not allowed on `video`/`hybrid` shots |
| `media` | required for `video`/`hybrid`, forbidden for canvas renderers; see §4.2 |
| `moduleParams` | optional JSON object of strings, finite numbers and booleans; only valid on `project:<id>` renderers |
| `sceneModules` | optional array (max 64) of trusted Canvas 2D module declarations |
| `sceneModules[].id` | lowercase letters/digits/hyphens, 3-64 chars, unique |
| `sceneModules[].path` | project-relative, under `scenes/`, `.ts` or `.tsx`, no links or traversal |
| `sceneModules[].moduleType` | `canvas2d` in contract version 1 |
| `sceneModules[].contractVersion` | exactly `1` |
| `sceneModules[].sha256` | lowercase 64-char hash of the exact module bytes; verified before bundling |
| `sceneModules[].trust` | exactly `user-authored-approved` |
| `sceneModules[].canvas` | `{"mode":"output"}`, `{"mode":"project-pixel"}` or `{"mode":"custom","width":N,"height":N}` |
| `sceneModules[].samplingFps` | positive integer, `output` or `project-pixel` |
| `sceneModules[].pixelated` | optional boolean; defaults to true for non-output canvases |
| `visual.pixel` | required when any shot or the default renderer is `pixel-canvas`; internal aspect must match output |
| `permissions.externalGeneration` | must be `false` in P0 |
| `permissions.localOnly` | must be `true` |
| `permissions.allowNetwork` | must be `false` |
| `render` | h264 / yuv420p / bt709 and png or jpeg frame capture |
| assets | unique id, kind, relative path, hash, source, rights, approval |

## 3. Duration policy

`durationInFrames = policy(audio.durationSeconds * output.fps)`

Examples:

| Audio | fps | Policy | Frames |
|---:|---:|---|---:|
| 2.0 | 24 | round | 48 |
| 1.5 | 30 | round | 45 |
| 1.49 | 24 | floor | 35 |
| 1.49 | 24 | ceil | 36 |

The policy is part of the project contract. The engine never assumes 4919 frames or 204.96 s. Audio mixing does not change `durationInFrames`; the final mix has `Math.round(durationInFrames * mixSampleRate / fps)` samples, and a subrange only selects its corresponding interval.

## 4. Renderers and params

| Renderer | Canvas | Sampling | Params |
|---|---|---|---|
| `pixel-canvas` | `visual.pixel.internalWidth × internalHeight` | `visual.pixel.samplingFps` | `background`, `accent`, `secondary`, `bars`, `motion`, `label` |
| `layered-canvas` | output width × height | output fps | `background`, `accent`, `secondary`, `assetId`, `motion`, `label` |
| `video` | output | output fps | `params` plus required shot-level `media` |
| `hybrid` | output | output fps | `params` plus required shot-level `media` with layers |
| `project:<id>` | module declaration (`output`, `project-pixel` or custom) | module declaration | `params` plus JSON-safe `moduleParams` validated by the module |

Declarative projects remain valid without `sceneModules`. A project-local module is executable code and requires the explicit approval contract described in §4.1. Video and Hybrid shot media are described in §4.2.

### 4.1 Project scene module contract

A declared module is a self-contained `.ts` or `.tsx` file under the project's `scenes/` directory. It exports an object as the default export or as a named `sceneModule` export:

```ts
const sceneModule = {
  id: 'runner',
  contractVersion: 1,
  moduleType: 'canvas2d',
  label: 'Synthetic pixel runner',
  params: [
    {key: 'speed', type: 'number', required: true},
    {key: 'glow', type: 'boolean'},
  ],
  assetDependencies: [],
  render(ctx, context) {
    const tick = context.frame.animationTick;
    ctx.fillStyle = context.params.background ?? '#0B1B2B';
    ctx.fillRect(0, 0, context.canvas.width, context.canvas.height);
    // Draw deterministically from frame-derived values.
    void tick;
  },
};

export default sceneModule;
```

`render(ctx, context)` receives:

- `context.frame.outputFrame`, `localFrame`, `outputTime`, `localTime`, `animationTick`, `animationTime`, `samplingFps` from the engine frame clock;
- `context.canvas.width/height` — the actual backing canvas size, which may be smaller than the output;
- `context.output.width/height/fps/durationInFrames` — the project output profile;
- `context.shot.id/chapterId/chapterTitle/startFrame/endFrame`;
- `context.params` — the approved declarative `SceneParams` copy;
- `context.moduleParams` — the shot's JSON-safe values after schema validation;
- `context.assets` — approved declared asset IDs mapped to public paths inside the staged bundle.

Rules:

- `params` is the required parameter schema. Unknown keys, missing required keys and wrong primitive types fail before the module draws.
- `assetDependencies` must reference approved assets declared in the project manifest; otherwise binding fails.
- Animation must use the supplied frame/tick/time values. The source policy rejects timers, clocks, `Math.random` and other nondeterministic or network entry points.
- Modules must not import or require other files, use dynamic code, access the DOM or environment, or embed network/data URLs.
- Modules receive frozen context objects and cannot change the project fps, duration, audio or other shots.

Validation order:

1. Parse and validate the manifest declaration (`ConfigValidationError`).
2. Resolve the path canonically under the project and reject absolute paths, traversal, symlinks and junctions (`SceneModuleError`).
3. Verify the SHA256 of the exact bytes before bundling.
4. Apply the static source policy to those verified bytes.
5. Copy the bytes to `<project>/cache/engine-bundle/modules/` and generate a static entry.
6. At bundle load, validate exported identity, contract version, module type, parameter schema, asset dependencies and render function.

After editing a module, update `sha256` in `project.json` as part of the approval. A helper on Windows PowerShell:

```powershell
(Get-FileHash scenes/runner.ts -Algorithm SHA256).Hash.ToLower()
```

Errors are fail-closed and named: manifest violations raise `ConfigValidationError`; path, hash, source-policy and binding failures raise `SceneModuleError`; the CLI exits nonzero and writes no render. The renderer never silently falls back to a built-in renderer.

A hash proves identity, not safety. Only run code you authored or explicitly approved. Importing the verified module executes its top-level code in the browser, so approval covers the whole file, not just `render`. There is no OS sandbox or browser network sandbox; do not load modules from remote sources, npm, GitHub or another project.

### 4.2 Video and Hybrid shot media

`video` and `hybrid` shots require a typed `media` object; canvas renderers must not declare one. `params.assetId` is rejected on media shots; the asset reference belongs in `media`.

Video source object:

```json
{
  "kind": "video",
  "assetId": "VIDEO-01",
  "sourceStartSeconds": 0.625,
  "fit": "cover",
  "endBehavior": "reject",
  "muted": true,
  "positionX": 0,
  "positionY": 0,
  "scale": 1
}
```

| Field | Rule |
|---|---|
| `assetId` | existing approved asset of kind `video` |
| `sourceStartSeconds` | finite, non-negative; must align to an output-frame boundary at the project fps |
| `fit` | `contain` or `cover`; defaults to `cover` |
| `endBehavior` | only `reject` is supported; defaults to `reject` |
| `muted` | must be `true`; embedded video audio is never emitted |
| `positionX`, `positionY` | finite output-pixel offsets; default 0 |
| `scale` | greater than 0 and at most 20; default 1 |

Hybrid media:

```json
{
  "kind": "hybrid",
  "video": {"assetId": "VIDEO-01", "sourceStartSeconds": 0.7, "fit": "cover", "endBehavior": "reject", "muted": true},
  "layers": [
    {"assetId": "LAYER-01", "order": 10, "opacity": 0.9, "fit": "contain",
     "positionX": 0, "positionY": 0, "scale": 1,
     "visibleFromFrame": 0, "visibleToFrame": 20}
  ],
  "overlay": {"kind": "rain", "intensity": 0.65, "color": "#B7F7E8"}
}
```

Hybrid rules:

- Bottom-to-top order: fallback background, video, PNG layers sorted by `order`, Canvas overlay.
- `layers` must contain between 1 and 16 entries.
- Each layer asset must be kind `layer` and an 8-bit RGBA or grayscale-alpha PNG.
- `order` is an integer `0..31` and unique within the shot.
- `opacity` is in `[0,1]`; `scale` is in `(0,20]`; positions are finite output-pixel offsets.
- `visibleFromFrame`/`visibleToFrame` are half-open shot-local ranges; defaults are `0` and the shot length. The end must not exceed the shot length.
- `overlay.kind` is `rain`, `orbits` or `scan`; `intensity` is in `[0,1]`; color is optional.
- Unknown keys, wrong asset kinds, missing/duplicate layer orders, empty layers, invalid overlays and invalid ranges fail closed.

Media validation sequence:

1. Manifest and asset approval/kind checks (`ConfigValidationError`).
2. Project-relative asset path, hash verification and staging.
3. FFprobe video probe: MP4, H.264, positive dimensions, constant frame rate, duration, audio presence, pixel format and zero rotation. VFR or rotated video is rejected with a preprocessing message.
4. PNG header probe for layer assets: IHDR, 8-bit channels, alpha-capable color type and safe dimensions.
5. Timeline validation: `sourceStartSeconds + shotDurationSeconds` must fit inside the probed source duration under `reject`.
6. Browser-side runtime checks repeat source availability and timing before the media element renders.

Source FPS may differ from output FPS; Remotion's decoder maps shot-local output time to the source. Variable-frame-rate sources are rejected and exact source-frame selection is not claimed for them. Source video audio is muted; the authoritative project mix is the only audio output.

The synthetic templates are under `factory/examples/media-projects/`. They are templates, not loadable manifests; `npm run media:seed` generates media and writes hash-approved `project.json` files into an external workspace. Generated media is not committed.

## 5. Audio master and tracks

### 5.1 Master soundtrack authority

- `audio` is the main music and the only declaration of the master soundtrack. `audioTracks` cannot declare a second music master.
- The master determines the project duration through `durationSeconds` and `durationPolicy`; decoded duration is verified but does not redefine the policy.
- Supported actual content:
  - `wav-pcm`: RIFF/WAVE, 16-bit PCM, mono or stereo.
  - `mp3`: MP3 audio.
  - `flac`: FLAC audio.
  - `m4a-aac`: MP4/M4A container with exactly one AAC audio stream and no video/other streams.
- Non-WAV sources require FFprobe for metadata and FFmpeg for an actual decode-duration check. The probe records container, codec, sample rate, channels/layout, probe and decoded duration, start time, encoder delay/padding, file size and source SHA256. MP3/AAC encoder delay and padding are decoder concerns; they are recorded and are not converted into a timeline offset.
- If `audio.assetId` is declared, the referenced asset must be an approved `audio-reference` with exactly the same canonical path and SHA256 as `audio.path`/`audio.sha256`.

### 5.2 Supplemental tracks

`audioTracks` is optional and backward compatible. Each entry:

| Field | Rule |
|---|---|
| `id` | lowercase letters/digits/hyphens (3-64), unique across tracks |
| `role` | `sfx`, `voiceover` or `ambience` |
| `assetId` | approved project asset of kind `audio-reference` |
| `startFrame` | integer `>= 0`; track begins on this output frame |
| `durationFrames` | integer `>= 1`; half-open output range; `startFrame + durationFrames` must not exceed the project duration |
| `sourceStartSeconds` | finite, non-negative, aligned to an output-frame boundary at the project fps; selects the source in-point |
| `gainDb` | finite dB in `[-60, 12]` |
| `fadeInFrames`, `fadeOutFrames` | non-negative integer frames; their sum must not exceed `durationFrames` |
| `muted` | optional boolean, default `false`; muted tracks are validated and reported but contribute no samples |
| `gainAutomation` | optional array (max 32) of `{frame, gainDb}` local to the track start; strictly increasing, bounded dB, no frame beyond the track duration |

Array order is the deterministic combination order. Overlapping tracks are summed. Track source ranges are checked against the decoded source duration at load time, not against file extensions or declarations.

### 5.3 Frame/sample mapping and mixing

- `frameToSampleIndex(frame) = Math.round(frame * sampleRate / outputFps)` for non-negative integer frames. Ranges remain half-open.
- `mixSampleCount = Math.round(durationInFrames * sampleRate / outputFps)`.
- Fades map through the same function. Fade-in is linear from 0 to unity across the first `fadeInFrames`; fade-out is linear from unity to 0 across the final `fadeOutFrames`.
- Master automation frames are project frames. Track automation frames are local to the track. Automation interpolates linearly in dB between points and holds the first/last value outside the point range.
- Sources are decoded and normalized by local FFmpeg to stereo signed 16-bit PCM at `mixSampleRate`. Mixing is deterministic Node code; no FFmpeg filtergraph or command string is accepted from project configuration.
- The mixer applies source in-point, gain, fades, automation, then sums all tracks and the master. If the summed peak exceeds `0.999`, a single deterministic gain scales the entire mix to `0.999`. The report records peak before/after, limiter gain, pre-limiter overflow samples and post-limiter clipped samples. No automatic loudness normalization is performed.
- A normal render uses the full project mix. A render of frames `[start, end]` slices the mix interval `[start, end + 1)` on frame-derived sample boundaries, so later sections of a project do not reuse the soundtrack start.
- Video frame ownership and shot cuts are never changed by audio processing.

### 5.4 Deterministic cue analysis

The render writes `reports/audio-analysis-<projectId>.json` for the master source with:

- algorithm version and source SHA256;
- sample rate, duration and output fps;
- analysis parameters (window, threshold ratio, minimum onset gap);
- peak value/time/frame;
- windowed RMS and peak envelopes;
- candidate onset events with time, frame, `source: "estimated"`, `classification: "estimated"`, `confidence: null` and an energy metric.

This is a candidate-event foundation. It does not compute BPM, meter, tempo changes, song sections, chorus boundaries, emotion, lyrics or transcriptions. Analysis results never overwrite `project.cues`; manually approved cues remain authoritative.

### 5.5 Preview and final output

- Preview audio is the generated PCM mix referenced through Remotion `<Audio>`.
- Final output muxes AAC exactly once from the same PCM mix (or its frame-range segment). Embedded video source audio remains muted.
- Preview and final output therefore share the same sample-domain mix but use different playback encodings. They are not claimed to be sample-identical.
- The final MP4 contains exactly one audio stream. A missing FFmpeg, unsupported decoder, failed mix or ambiguous source fails the render rather than silently emitting a different soundtrack.
- Analysis and mixing never change shot boundaries, chapter ownership, `durationInFrames` or the declared duration policy.

## 6. Assets and approval

- `approved`: hash-verified, staged to `cache/render-public`, usable.
- `pending`, `rejected`, `not_present`: never staged and never usable in a scene.
- Module `assetDependencies` are resolved only against approved project assets; missing or unapproved dependencies fail binding.
- Rights and source are mandatory strings; secrets and private paths must not appear.
- The master soundtrack may also be declared as an approved `audio-reference` asset and referenced through `audio.assetId`. Supplemental tracks must use approved `audio-reference` assets. All audio paths, hashes and decoded durations are verified.

## 7. Examples

- `factory/examples/projects/synthetic-pixel-demo/project.json` — 1920x1080, 24fps, 48 frames, 12fps pixel sampling, 2 shots, declarative only.
- `factory/examples/projects/synthetic-layered-demo/project.json` — 1080x1350, 30fps, 45 frames, layered renderer, approved background image, declarative only.
- `factory/examples/projects/synthetic-module-pixel-demo/` — 1920x1080, 24fps, 48 frames, 480x270 project-pixel canvas, 12fps module sampling, two external TS modules (`runner`, `signal`).
- `factory/examples/projects/synthetic-module-layered-demo/` — 900x1600, 30fps, 45 frames, full-resolution external TSX modules (`aurora`, `ribbons`), approved synthetic background image.
- `factory/examples/media-projects/synthetic-video-demo/` — template for 1920x1080, 24fps, two Video shots, 30fps source, 0.625s and 2.0s source in-points, synthetic soundtrack.
- `factory/examples/media-projects/synthetic-hybrid-demo/` — template for 1080x1920, 30fps, two Hybrid shots, 24fps source, transparent PNG ring, rain/orbits Canvas overlays, synthetic soundtrack.
- `factory/examples/audio-projects/synthetic-audio-mp3-demo/` — 24fps MP3 master with a referenced PCM source, numeric pixel renderer, two 1 kHz bursts.
- `factory/examples/audio-projects/synthetic-audio-multitrack-demo/` — 30fps Hybrid project with a FLAC master, WAV SFX/voiceover, AAC/M4A ambience, explicit gain/fades and master ducking automation.
- `factory/examples/audio-projects/synthetic-audio-boundaries-demo/` — 24fps, 44.1 kHz mix, three synthetic clicks, an odd-frame shot cut at frame 25 and a nonzero render subrange.
- `factory/examples/preproduction-projects/synthetic-beat-demo/` — 30fps 640×360 strong 120 BPM project with approveable annotations/brief and a real storyboard preview from approved manual timing.
- `factory/examples/preproduction-projects/synthetic-beat-grid-demo/` — 30fps 640×360 90 BPM project with **no** manual BPM, beat anchor or cut cue, so the approved beat-grid candidate supplies every interior shot cut in its rendered preview.
- `factory/examples/preproduction-projects/synthetic-uncertain-demo/` — 30fps 540×960 sparse/irregular project planned from manual anchors and sections.
- `factory/examples/preproduction-projects/synthetic-lyrics-demo/` — 24fps 720×540 synthetic lyrics/narrative project with a deliberately missing image requirement.

Copy the declarative/module projects into `MV_WORKSPACE_ROOT` with `factory/scripts/seed-workspace.mjs`. Generate the media projects with `npm run media:seed`, the audio projects with `npm run audio:seed`, and the preproduction projects with `npm run preproduction:seed`. Media/audio templates require FFmpeg/FFprobe and are not directly loadable until seeded.

## 8. Adding a new project without engine changes

1. Create `MV_WORKSPACE_ROOT/<projectId>/` outside the repository.
2. Add `project.json`, approved audio and assets. For non-WAV masters, confirm FFmpeg/FFprobe decoding and the declared format before relying on duration.
3. Choose existing renderers and params, or declare trusted modules under `scenes/` with their hashes and `user-authored-approved` trust.
4. For video/hybrid shots, add typed `media` with approved asset IDs, output-frame-aligned source in-points, fit/scale and explicit layer/overlay configuration.
5. For multitrack audio, add approved `audio-reference` assets and `audioTracks` with frame ranges, source in-points, gain, fades and bounded automation.
6. Write frame-domain chapters/shots and optional `moduleParams`.
7. Validate with the loader/tests, then render via `factory/scripts/render-project.mjs`.
8. For module projects, run `npm run verify:modules`; for media projects, run `npm run media:seed` and `npm run media:verify`; for audio projects, run `npm run audio:seed` and `npm run audio:verify` in a disposable external workspace.

No engine source edit is required for a new duration, fps, dimension, shot count, style profile, declarative renderer configuration, media shot or declared Canvas 2D module.

## 9. Preproduction files and candidate compilation

Preproduction is project-local and does not extend the active `project.json` schema directly. It lives under `<project>/preproduction/`:

| File | Purpose |
|---|---|
| `annotations.json` | approved manual BPM, beat anchors, cut cues and half-open sections |
| `creative-brief.json` | user-authored style-independent direction and pacing |
| `lyrics.lrc` or `lyrics.json` | optional user-supplied timed lyrics |
| `beat-grid.json` | versioned estimated beat candidates and evidence; always `approval: "unapproved"` |
| `approved-beat-grid.json` | one reviewer-selected interpretation of `beat-grid.json`, re-validated against the current grid on every load |
| `director-plan.json` | proposed/approved plan and revision |
| `storyboard.json` | execution-facing frame-accurate plan with asset/missing status |
| `asset-requirements.json` | actionable requirements and fulfillment status |
| `project-candidate.json` | validated candidate config, written only if render-ready |
| `compile-report.json` | ready/blocked compilation decision |
| `missing-assets.json` | blocked-report detail when requirements are unfulfilled |
| `revisions/` | traceable prior approval, plan and storyboard revisions |

Generation artefacts live beside preproduction under `generation/`: `jobs.json`, `permissions.json`, `outputs/<jobId>/`, `staging/<jobId>/`, `manifests/<jobId>.json`, `fixtures/` and `reports/`. They are project-local, never committed, and generated bytes enter the same `asset-intake.json` used by manual handoff. See [docs/generation.md](docs/generation.md).

Manual annotations require `source: "user"` and approval. An estimated beat grid never becomes timing on its own: `plan` resolves approved manual timing first, then an explicitly approved grid, and otherwise fails closed with `No approved timing source`. Candidate compilation requires an approved storyboard with no missing requirements, preserves the project's master audio/hash, fps, duration, cue identity, audio tracks and renderer contracts, and runs `validateProjectConfig`. It never overwrites `project.json`. The preview CLI loads the candidate separately. See [docs/preproduction.md](docs/preproduction.md).
