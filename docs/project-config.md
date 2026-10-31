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
    "format": "wav-pcm"
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
| `audio.durationSeconds` | positive; for PCM WAV must match the header within 0.02 s |
| `audio.durationPolicy` | `round`, `floor` or `ceil` |
| `output.width/height/fps` | positive integers; fps <= 120 |
| `output.durationInFrames` | optional; if present must equal the audio-derived duration |
| `cues[].frame` | integer in `[0, duration]`; `timeSeconds` must agree within half a frame |
| `cues[].source` | `measured`, `estimated` or `synthetic` |
| chapter/shot frames | integers, `startFrame < endFrame`, chapters cover `[0, duration)` exactly, shots cover each chapter exactly |
| `renderer` | must be registered in the scene registry; `project:<id>` must reference a declared scene module |
| `params.assetId` | must reference an existing `approved` asset |
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
| `render` | P0 supports h264 / yuv420p / bt709 and png or jpeg frame capture |
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

The policy is part of the project contract. The engine never assumes 4919 frames or 204.96 s.

## 4. Renderers and params

| Renderer | Canvas | Sampling | Params |
|---|---|---|---|
| `pixel-canvas` | `visual.pixel.internalWidth × internalHeight` | `visual.pixel.samplingFps` | `background`, `accent`, `secondary`, `bars`, `motion`, `label` |
| `layered-canvas` | output width × height | output fps | `background`, `accent`, `secondary`, `assetId`, `motion`, `label` |
| `project:<id>` | module declaration (`output`, `project-pixel` or custom) | module declaration | `params` plus JSON-safe `moduleParams` validated by the module |
| `video` | output | output fps | placeholder; throws |
| `hybrid` | output | output fps | placeholder; throws |

Declarative projects remain valid without `sceneModules`. A project-local module is executable code and requires the explicit approval contract described in §4.1.

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

## 5. Assets and approval

- `approved`: hash-verified, staged to `cache/render-public`, usable.
- `pending`, `rejected`, `not_present`: never staged and never usable in a scene.
- Module `assetDependencies` are resolved only against approved project assets; missing or unapproved dependencies fail binding.
- Rights and source are mandatory strings; secrets and private paths must not appear.
- The soundtrack is separate from the asset list but is hash- and duration-verified.

## 6. Examples

- `factory/examples/projects/synthetic-pixel-demo/project.json` — 1920x1080, 24fps, 48 frames, 12fps pixel sampling, 2 shots, declarative only.
- `factory/examples/projects/synthetic-layered-demo/project.json` — 1080x1350, 30fps, 45 frames, layered renderer, approved background image, declarative only.
- `factory/examples/projects/synthetic-module-pixel-demo/` — 1920x1080, 24fps, 48 frames, 480x270 project-pixel canvas, 12fps module sampling, two external TS modules (`runner`, `signal`).
- `factory/examples/projects/synthetic-module-layered-demo/` — 900x1600, 30fps, 45 frames, full-resolution external TSX modules (`aurora`, `ribbons`), approved synthetic background image.

Copy them into `MV_WORKSPACE_ROOT` with `factory/scripts/seed-workspace.mjs`. Generated audio and images are synthesized locally and ignored by Git.

## 7. Adding a new project without engine changes

1. Create `MV_WORKSPACE_ROOT/<projectId>/` outside the repository.
2. Add `project.json`, approved audio and assets.
3. Choose existing renderers and params, or declare trusted modules under `scenes/` with their hashes and `user-authored-approved` trust.
4. Write frame-domain chapters/shots and optional `moduleParams`.
5. Validate with the loader/tests, then render via `factory/scripts/render-project.mjs`.
6. For module projects, run `npm run verify:modules` to bundle and render boundary/hold evidence.

No engine source edit is required for a new duration, fps, dimension, shot count, style profile, declarative renderer configuration or declared Canvas 2D module.
