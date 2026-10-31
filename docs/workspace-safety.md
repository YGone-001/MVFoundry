# Workspace Safety

## Required configuration

`MV_WORKSPACE_ROOT` is required for loading, seeding and rendering projects. Missing configuration fails closed; there is no fallback into this repository.

The root must already exist. Create it outside the repository, for example:

```bash
mkdir -p /absolute/path/outside/this/repository/MV-Workspaces
export MV_WORKSPACE_ROOT=/absolute/path/outside/this/repository/MV-Workspaces
```

## Enforced rules

- The workspace root must be canonicalized and must not be inside this repository.
- The workspace root must not contain this repository.
- Project IDs must match `[a-z0-9][a-z0-9-]{2,63}`.
- The project directory name must equal `projectId`.
- `project.json` must exist.
- Project, audio and asset paths are canonicalized.
- Absolute paths and parent traversal are rejected.
- Symlinks and Windows junctions that escape the project or point into the repository are rejected.
- Only approved, hash-verified assets are staged.
- Staging, frames, caches, reports and renders stay inside the external project.
- No public HTTP service is created for local media.

## Resulting workspace

```
<MV_WORKSPACE_ROOT>/<projectId>/
  project.json
  source/audio/
  source/lyrics/
  source/rights/
  analysis/
  writing/
  visual/
  assets/images/
  assets/video/
  assets/layers/
  scenes/          # declared trusted Canvas 2D modules
  references/      # optional project-local PCM/reference fixtures
  cache/
    engine-bundle/ # generated entry, verified module copies, webpack output
    audio-normalized/ # decoded stereo PCM copies keyed by source hash
    audio-mix/     # authoritative project mix and frame-range segments
  renders/
  reports/         # render, mix, analysis and evidence reports
```

All song-specific content belongs here, never in the engine repository.

## Central write boundary

Every engine-authored project write goes through `factory/src/workspace/writeBoundary.ts`:

- authorized root: the canonical project directory;
- cache writes: only inside `<project>/cache`;
- render writes: only inside `<project>/renders`;
- source audio, approved asset files and declared scene-module sources cannot be overwritten;
- existing ancestors and the destination are checked for traversal, symlinks and Windows junctions;
- destinations that do not exist yet are resolved under the canonical root;
- engine-repository paths and other projects are rejected;
- validation failure is fatal.

The local Remotion/Webpack bundler writes its own generated output tree directly into the pre-validated `<project>/cache/engine-bundle/bundle` directory. That directory is created through the boundary, is a strict cache descendant and starts empty; the trusted bundler's individual output files are not passed through `assertSafePath`. The generated entry and verified module copies do pass through the boundary. Do not treat the bundler as a security boundary for arbitrary project-controlled webpack configuration; MVFoundry does not load project webpack configuration.

Ordinary Node.js filesystem APIs do not provide atomic `openat`-style guarantees. A concurrent attacker that can change the filesystem between validation and write could race the boundary. This limitation is explicit; the engine does not claim race-free protection.

## External scene modules

Project-local scene modules are executable code and follow a stricter contract:

- Paths must be project-relative, under `scenes/`, end in `.ts` or `.tsx` and have no empty, current or parent segments.
- Canonical resolution must remain inside the project and outside the engine repository.
- Every component of the path is checked with `lstat`; symlinks and Windows junctions are rejected even when they point inside the project.
- The declared SHA256 must match the exact bytes before the module is staged for bundling.
- `trust` must be exactly `user-authored-approved`; duplicate IDs, unknown module types, missing files and unapproved modules fail closed.
- The source policy rejects imports, re-exports, dynamic import, `require`, string-constructed functions, network/data URL literals, DOM access, browser storage, environment access, timers, clocks and `Math.random`.
- Verified bytes are copied to `<project>/cache/engine-bundle/modules/`; the generated entry, bundle and public copy remain under `<project>/cache/engine-bundle/`.
- The original module file is protected by the write boundary and cannot be overwritten by render, staging or cache operations.

The static policy is a rejection policy, not a sandbox. It cannot prove arbitrary TypeScript is benign, and no OS or browser-network isolation is implemented. Importing the verified module executes its top-level code in the browser when the bundle loads; runtime identity and parameter checks occur after import. Only run trusted user-authored or explicitly approved local modules; never load scene code from a manifest-supplied remote source. The staged copy is re-hashed immediately before bundling, but the workspace is not locked against concurrent local mutation.

At bundle load, module ID, contract version, module type, render function, parameter schema and asset dependencies are validated again. Unknown shot parameters, missing required parameters, unstaged assets and undeclared module renderers stop the render.

## Media and layer assets

- Video sources are ordinary approved `video` project assets. Their project-relative path, canonical containment, SHA256 and approval are checked before FFprobe runs.
- FFprobe validates MP4 container, H.264 codec, dimensions, constant frame rate, duration, audio presence and zero rotation. VFR, rotated, corrupt, unsupported or missing sources fail closed.
- Layer assets must be approved `layer` assets whose PNG IHDR reports 8-bit channels and color type 6 (RGBA) or 4 (grayscale-alpha), within safe dimensions. Opaque or unsupported PNGs are rejected.
- Only local project files are used. There is no HTTP media source support and no cross-project asset reference.
- Video source audio is muted; the authoritative project mix is the only audio output.
- Approved media is staged through the existing `<project>/cache/render-public` boundary and served to the local Remotion bundle.
- Source video/layer files are protected by the write boundary and are never overwritten.
- Synthetic video, PNG and WAV fixtures are generated by `npm run media:seed` only inside a disposable external workspace. They are not committed to the engine repository.
- The media seed/verify commands must not point at the user's production workspace during synthetic acceptance. Prefer an OS temporary directory; the source hashes of real workspaces remain untouched.

Media timing and layer validation happen before rendering. A rejected source does not produce an accepted-looking output.

## Audio assets

- The master `audio` and every supplemental track must resolve to project-local files. Audio assets used by tracks are approved `audio-reference` manifest entries with project-relative paths, SHA256, source and rights.
- `audio.assetId`, when present, must match the master path and hash exactly. A track cannot reference a video, image, layer or another project's audio.
- Actual content is probed with the pure WAV header or FFprobe. MP3, FLAC and AAC-in-M4A require FFmpeg for duration and normalization; missing tools fail closed.
- Approved and pending/rejected audio follow the same approval rules as other assets: only approved sources are read for mixing.
- Original audio is immutable. Decoded/normalized copies, the final mix, frame-range segments and analysis/mix reports are engine outputs under `<project>/cache/` and `<project>/reports/`.
- The mix is the only final audio authority. Embedded video audio is muted. No project configuration can inject an FFmpeg filtergraph, shell command or remote audio URL.
- Synthetic audio fixtures are generated only by `npm run audio:seed` inside a disposable external workspace. They must not be committed and must not be seeded into a real production workspace during acceptance.

## Render output overrides

- Default output: `<project>/renders/<projectId>-render.mp4` or `...-still-NNNN.png`.
- Relative `--out`: a single filename directly inside `renders/`.
- Absolute `--out`: a direct child of `renders/`.
- Rejected: traversal, nested relative paths, other projects, engine paths, linked destinations, source audio/assets.
- Negative tests confirm rejected paths write no output files.

## Cache cleanup

- Cleanup is limited to strict descendants of `<project>/cache`.
- The cache root and project root cannot be deleted.
- Existing link entries under the target are rejected before deletion.
- Staging recreates only `<project>/cache/render-public` through the same validator.
- Original approved media and audio remain untouched and are hash-checked before and after staging.

## Tests

The engine tests cover:

- missing `MV_WORKSPACE_ROOT`;
- workspace roots inside or containing the repository;
- project ID traversal;
- missing `project.json`;
- junction escapes to the repository and to an outside directory;
- manifest path traversal, absolute paths and link escapes;
- scene-module traversal, absolute paths, missing files, invalid hashes, unapproved trust, duplicate IDs, unknown types, linked paths and cross-project junctions;
- module source imports, network URLs, DOM/environment access, timers, randomness and dynamic code;
- module identity, parameter schema and asset-dependency failures at bundle load;
- media configuration, wrong asset kinds, unapproved/missing assets, invalid in-points, timing, opacity, layer order, visibility, overlay and PNG metadata;
- video probe rejection for corrupt, unsupported, VFR/rotated, missing and too-short sources;
- audio master/track approval, kind, path, hash, format, decoded-duration and track-range failures;
- audio probe rejection for malformed, mislabeled, multichannel and unexpected-stream sources;
- audio frame/sample mapping, subrange slicing, gain/fade/automation, limiter diagnostics and source preservation;
- output overrides outside renders, traversal, other projects and engine paths;
- linked render destinations and cache cleanup targets;
- staging links and source preservation;
- seed roots inside the engine and seed target links.

These are unit tests over real temporary directories, not claims based on `.gitignore`. Windows junction behavior is covered by the Windows CI job; tests that cannot create a link on a host are skipped, never marked PASS.
