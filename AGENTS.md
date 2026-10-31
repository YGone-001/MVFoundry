# AGENTS.md — MVFoundry

## Mission

MVFoundry is a local-first, song-independent AI music video production framework. Engine source lives in this repository; every song production lives outside it in an external workspace addressed by `MV_WORKSPACE_ROOT`.

## Repository identity

- Project name: MVFoundry.
- Subtitle: AI Music Video Production Framework.
- Repository: https://github.com/YGone-001/MVFoundry
- Target branch: `main`.
- This repository contains reusable engine code only.

## Source of truth

1. Actual source and observed command output.
2. `README.md`, `ARCHITECTURE.md`, `factory/` and its tests.
3. `docs/project-config.md`, `docs/official-skills.md`, `docs/workspace-safety.md`, `docs/rendering.md`.
4. The external project's `project.json`, approved assets, hashes and rights records.
5. The five active Skills in `.agents/skills/`.

Do not treat plans, prior reports or user summaries as proof of the current files.

## Hard invariants

### Engine / production separation

- Never add a song, recording, lyric, reference image, production scene or rendered video to this repository.
- Never copy production media into tests, fixtures, caches or build output.
- A new production must be loadable from configuration without editing engine source.
- Synthetic fixtures must be clearly synthetic, generated, and free of third-party media.

### Workspace safety

- `MV_WORKSPACE_ROOT` is required. Missing configuration must fail closed; there is no repository fallback.
- Workspace roots inside this repository, or that contain this repository, are rejected.
- Project IDs are restricted; directory names must equal `projectId`.
- All manifest paths are canonicalized. Absolute paths, parent traversal and junction/symlink escapes are rejected.
- Staging, frames, caches, reports and renders stay inside the external project.
- No public HTTP service may expose local media.

### Safe filesystem writes

- All engine-authored project writes go through `factory/src/workspace/writeBoundary.ts`; do not add ad-hoc `rmSync`, `writeFileSync` or `copyFileSync` paths that bypass it.
- The trusted Remotion/Webpack bundler writes its own output tree into a pre-validated, freshly created `<project>/cache/engine-bundle/bundle` directory; project webpack configuration is never loaded. Do not describe this trusted-tool output as passing per-file boundary checks.
- Render output defaults to `<project>/renders/`. `--out` accepts a single filename relative to renders or an absolute direct child of renders; reject traversal, other projects, the engine repository and linked destinations before writing.
- Staging may write only under `<project>/cache/render-public`; cleanup may recreate only strict descendants of `<project>/cache`.
- Never delete the project cache root, the project root, source audio, approved source assets or declared scene-module sources.
- Validate existing ancestors and destinations; reject symlinks and Windows junctions. Ordinary Node.js filesystem APIs cannot guarantee protection against concurrent malicious mutation; do not claim race-free security.
- Test negative paths and verify no output was written.

### External scene modules

- Project-local scene modules are executable code. Only explicitly declared, user-authored or user-approved local modules may be loaded.
- A module path must be project-relative, under `scenes/`, canonicalized inside the project and free of symlinks or Windows junctions.
- Verify the declared SHA256 against the exact bytes before bundling. A hash proves identity, not benign behavior.
- `trust` must be exactly `user-authored-approved`; missing, duplicate, unknown-type, unapproved or cross-project modules fail closed.
- Never import or execute project modules in the Node host. Node performs path, hash and static source-policy checks only.
- Reject imports, re-exports, dynamic code, network APIs or URLs, DOM/environment access, timers, clocks and randomness in module source. This is not a sandbox; do not claim OS or browser-network isolation.
- Generate the entry, verified module copies and webpack output only under `<project>/cache/engine-bundle/`. Never copy scene source into this repository or another project's cache.
- Build a per-project bundle with explicit static imports and a controlled engine alias. Do not use `eval`, dynamic unverified imports, arbitrary `require()` paths or a global mutable scene registry.
- Bind module identity, contract version, type, parameter schema and approved asset dependencies at bundle load. Unknown parameters or missing assets stop rendering.
- Do not serialize module functions through Remotion `inputProps`.

### Media assets and renderers

- Video sources must be approved project assets of kind `video`, project-relative, SHA256-verified and FFprobe-validated before rendering. Only local MP4/H.264 constant-frame-rate, zero-rotation sources are supported.
- Validate source in-point alignment to the output frame, source duration against the shot range, fit/scale/position and the fail-closed `reject` end behavior.
- Embedded video audio must remain muted. The single authoritative project audio mix is the only authorized audio output.
- Hybrid layers must be approved `layer` assets and 8-bit RGBA or grayscale-alpha PNGs. Enforce explicit order, opacity, fit/position/scale, shot-local visibility and supported overlays.
- Do not add HTTP media sources, unrestricted remote URLs or cross-project asset references.
- Synthetic video/PNG/audio fixtures are generated with FFmpeg into an external disposable workspace; never commit generated media or place it in the engine repository.
- Do not use a real production workspace for synthetic media or audio seeding/verification.

### Audio engine

- The master `audio` declaration remains the duration/timeline authority. Do not create a second master soundtrack through `audioTracks`; supplemental roles are `sfx`, `voiceover` and `ambience`.
- Supported master/track formats are `wav-pcm`, `mp3`, `flac` and `m4a-aac`. Detect content with the WAV header or FFprobe; never trust the filename extension.
- Every audio source must be an approved `audio-reference` project asset with a project-relative path, SHA256, source label and rights record. When `audio.assetId` is present it must exactly match the master path and hash.
- Verify decoded duration. Use 0.02 s tolerance for WAV and `max(0.05 s, 1/outputFps)` for lossy formats. Do not confuse MP3/AAC encoder priming with timeline drift.
- Map audio only through the integer output-frame clock: `Math.round(frame * sampleRate / outputFps)`, half-open ranges. Mix sample rate is 44.1 or 48 kHz. Preserve nonzero render subranges by slicing the corresponding mix interval, never the start of the track.
- Decode/normalize with local FFmpeg to stereo signed 16-bit PCM at the project mix rate. Mix deterministically in Node. Do not accept FFmpeg filtergraphs, shell strings or arbitrary commands from project configuration.
- Use a documented headroom policy: apply one global deterministic limiter gain only when the summed peak exceeds 0.999; report peak before/after, limiter gain and clipping diagnostics. Never silently normalize a whole song to hide clipping.
- Fades and automation are frame-declared and sample-applied. Master automation is project-local; track automation is relative to the track start. Ducking must be an explicit envelope, not claimed as intelligent detection.
- Produce one project-local PCM mix and mux exactly one AAC stream from it. Do not mix Remotion preview audio, embedded video audio and FFmpeg output as competing final authorities.
- Analysis must record source hash, algorithm version, parameters, timestamp, frame, evidence metric and `estimated` provenance with `confidence: null`. Do not claim BPM, sections, meter, lyrics, emotion or automatic music understanding. Analysis never overrides approved manual cues.
- Normalized audio, mixes, analyses and evidence stay under the external project cache/reports. Source audio is immutable. Never commit audio, stems, mixes or generated media.
- Preview uses the generated PCM mix via Remotion `<Audio>`; final output uses AAC encoding of the same mix. Do not claim sample-identical preview/final playback. Verify actual decoded output, not the presence of an audio stream.

### Timeline and rendering

- Integer output frames are the canonical editing clock; scene ranges are half-open `[startFrame, endFrame)`.
- Resolve the shot from the raw output frame before applying renderer sampling.
- Renderer sampling is local to the selected renderer. Use `floor(localFrame * samplingFps / outputFps)`; never quantize before selection.
- Video/Hybrid media playback is inside a shot-local Sequence; Remotion `trimBefore` is in composition-frame units.
- The approved master duration and integer output-frame clock are authoritative; audio samples map to frames through the documented rounding policy and are never retimed by animation sampling.
- Do not make one song's duration, scene count, resolution, fps or pixel profile a global constant.
- Local rendering uses Remotion `renderFrames` plus system FFmpeg in the current environment.

### Skills and evidence

- Active project Skills: `music-video-director`, `visual-identity-continuity`, `ai-shot-production`, `remotion-mv-compositor`, `music-video-quality-gate`.
- Official Remotion Skills are installed separately; they are not vendored here.
- Any completion claim requires observed evidence. Missing evidence is NOT RUN, never PASS.

### Publication and provider activity

- No commit or push unless the user explicitly authorizes it.
- No paid API, model call, upload, remote deployment or third-party transmission of local media.
- No secrets, credentials, tokens or private absolute paths in source, docs or fixtures.
- Use the publication allowlist and audit before staging; never `git add .` or `git add -A`.
- CI is engine-only: no production workspace, media artifacts or paid services. See `.github/workflows/engine-ci.yml`.

## Commands

```bash
npm ci
npm run typecheck
npm test
npm run compositions
npm run seed:examples
npm run media:seed
npm run media:verify
npm run audio:seed
npm run audio:verify
npm run render:project -- --project synthetic-pixel-demo --mode video --frames 0-23
npm run render:project -- --project synthetic-module-pixel-demo --mode video --frames 0-47
npm run verify:modules
npm run audit:git
npm run audit:publication
```

Set `MV_WORKSPACE_ROOT` to a path outside this repository. Set `REMOTION_BROWSER_EXECUTABLE` or `CHROME_PATH` when Remotion cannot locate a browser. `npx remotion browser ensure` installs a managed browser for CI or a fresh host. Media fixture generation/probing and video encoding require system FFmpeg and FFprobe.

## Skill routing

- Song analysis, treatment, chapters, cues, shots → `music-video-director`.
- Style profile, palette, character/environment continuity → `visual-identity-continuity`.
- AI shot contracts, keyframes, hashes, provider authorization → `ai-shot-production`.
- Frame clock, registry, renderers, local media, Remotion composition → `remotion-mv-compositor`.
- Acceptance, audits, PASS/FAIL/BLOCKED/NOT RUN → `music-video-quality-gate`.
- Remotion API or CLI questions → official `remotion-*` Skills.

## Agent startup

Agents that do not auto-discover `.agents/skills` must read this file and the five active Skill files explicitly. Native discovery is not universal across Codex, DeepSeek or other clients.

## Scope boundary

The reusable engine supports declarative renderers, trusted project-local Canvas 2D scene modules, local Video/Hybrid media composition, multi-format audio ingestion, frame-locked multitrack mixing and deterministic cue analysis. It does not start a music-video production, generate media with AI, migrate a private production, call providers, implement automatic music understanding or publish production scenes. Stop before unauthorized provider, publication or production work.
