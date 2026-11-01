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
3. `docs/project-config.md`, `docs/official-skills.md`, `docs/workspace-safety.md`, `docs/rendering.md`, `docs/preproduction.md`.
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

### Preproduction planning

- The beat-grid analyzer is separate from the P1-D onset report. Candidate beats, tempo and phase are estimated evidence, never approved timing. Report half/double ambiguity, offbeat activity, tempo-change suspicion, insufficient evidence and the frame-zero detection-domain boundary explicitly. Never add a frame-zero beat to make a check pass; a start anchor must come from an approved manual annotation.
- An estimated beat grid reaches director timing only through an explicit `approve-beats` record that keeps the measured provenance and the reviewer's chosen interpretation. That record is re-validated against the current grid on every load, so re-analysis makes it stale instead of silently reusing it. A high confidence score alone authorizes nothing, and an ambiguous grid cannot be approved without acknowledging the competing interpretation.
- Approved manual BPM, beat anchors, cut cues and sections take precedence over any approved grid. Reanalysis must never overwrite user-approved annotations, an approved director plan, an approved storyboard or an approved beat grid.
- Manual BPM/anchors/cues/sections require `source: "user"` and explicit approval. Use half-open frame ranges and validate frame/time agreement, gaps, overlaps and duration bounds.
- Optional lyrics must be user-supplied local UTF-8 LRC or structured JSON. Never transcribe, fetch, infer or upload lyrics. Validate timestamps, frame mapping, section references and duration; preserve text and approved timing.
- The creative brief is user-authored style-independent intent, not music evidence. Do not hardcode a song, style, ratio, palette, language, section count or shot count.
- Director plans must use explicit approved timing/creative inputs and label every shot boundary with one of `manual-bpm`, `manual-beat`, `manual-cut`, `section`, `approved-beat-grid`, `project-cue` or `lyric`; there is no unapproved beat source. Never turn every transient into a cut. Preserve proposed/approved/rejected revisions; do not overwrite an approved plan with reanalysis.
- Storyboards must cover the complete duration with unique, contiguous half-open shots; reference approved cues/assets/lyrics; verify that any `approved-beat-grid` shot cites a beat recorded in the plan's approval; and expose missing requirements. A requirement is not an asset.
- Missing assets must block compilation. Write a separate candidate configuration and validate it with the existing project validator; never overwrite `project.json` automatically or invent asset IDs.
- Storyboard previews must load the compiled candidate through the normal loader so the rendered shot selection actually comes from the approved storyboard. All generated plans, lyrics, assets, previews and reports stay external to Git.
- No provider calls, image/video generation, transcription or real-song migration are authorized in this phase.

### Media-aware storyboards and asset handoff

- Planned Video/Hybrid media is intent, never configuration. It uses the accepted P1-C media vocabulary (`ShotVideoMedia` / `ShotHybridMedia` shapes) with no asset ID until an approved binding exists; there is no second media schema.
- Renderer family is chosen per shot from `creative-brief.rendererDirectives`, so one storyboard can mix pixel/layered Canvas, project modules, Video and Hybrid shots. Never downgrade a missing Video or Hybrid shot to Canvas just to make compilation pass; the shot stays blocked.
- Every planned media slot (`backgroundSlot`, each Hybrid layer `slot`) must map to exactly one requirement with the same `mediaSlot`, and its approved asset kind must match (`video` background, `layer` plate).
- `attach-asset` only accepts a project-relative path inside the project, verifies existence, computes SHA256, probes real format (`probeVideo`, `probeLayerPng`), checks renderer compatibility and source-duration sufficiency, and records provenance and rights. It always lands as `review: "pending"`.
- `review-asset` is the only path to `approved`. Technical validation never auto-approves, and a user rights declaration is a recorded assertion, not independent legal verification.
- Intake records carry a requirement `fingerprint`. If the requirement changes, the record is stale: the requirement returns to unfulfilled and compilation stays blocked instead of binding the old bytes.
- Approved intake assets that are not declared in `project.json` are added only to the compiled candidate's asset table. `project.json` is never rewritten, and the candidate is re-validated by the existing project validator and the normal loader/probe path at render time.
- Embedded source-video audio stays muted; the project mix is the only final audio authority. `endBehavior: reject` is the only supported end-of-source policy.
- Continuity is declarative only: `continuity.json` records identity, kind, attributes, shot references, optional approved reference assets, revision and explicit `supersedes`. Two approved entries with the same identity and kind are contradictory unless one supersedes the other. Never claim face, character or image-similarity checking.
- Re-planning must not silently replace approved continuity entries, approved plans, approved storyboards or accepted assets; each needs an explicit new revision.
- Production tasks are work orders, not assets. Status distinguishes needed, in-production, delivered, under-review, approved and rejected, and a stale record reads as needed again.

### AI generation jobs and provider adapters

- A generation job is versioned, project-local and traceable to exactly one approved requirement: job id, project, requirement id, storyboard revision, requirement fingerprint, shot ids, provider, operation, model, request revision, compiled prompt, output spec, continuity ids and revisions, input asset refs, permission state, execution state, provider task id, attempts, result files with hashes, failure detail, and review state.
- Job identity is deterministic over the requirement fingerprint, request specification and revision. Re-preparing the same request returns the same job instead of submitting again. A timeout after submission parks the job as `unknown-submission-state` and blocks any retry until the provider task id is reconciled; a timeout is never treated as a safe retry.
- Provider execution state and human review state are separate. `succeeded` is not `approved`, and no successful provider task may become a production asset without an explicit review decision.
- LIVE_PROVIDER_EXECUTION is NOT_GRANTED by default. Live submission requires a per-job permission record naming project, job, provider, model, operation, input assets, upload intent, spend ceiling, submission count and authorization revision. A project `allowNetwork: true`, an approved storyboard or publication permission is never sufficient authorization to spend money.
- The fail-closed gate blocks when network activity is disabled, credentials are missing, the provider or model is unsupported, limits are exceeded, private reference upload is unauthorized, source provenance cannot be verified, the requirement is stale, or the attempt cap is reached.
- Credentials are read only from the environment. They never enter project.json, storyboards, job JSON, Git files, AGENTS.md, CI logs, reports or render metadata, and authorization headers are never printed.
- Provider capabilities are declarative manifests validated before submission: operation, output kind, model, aspect ratio, duration, resolution, reference count, seed, alpha and audio support. Unsupported requests are rejected before any submission; mandatory constraints are never dropped silently.
- The Runway adapter implements the documented `X-Runway-Version` contract (text-to-image, image-to-video, task status, output retrieval) through an injected transport only. There is no ambient fetch in that path, so no live call can occur by accident. The phase did not execute it live.
- The offline fixture provider writes real PNG/MP4 bytes for acceptance and marks them `synthetic-offline-test-output`. Offline synthetic media is never described as AI-generated.
- Generated output is staged inside the project, hashed, probed (`probeVideo`, `probeLayerPng`) and submitted to the existing asset-intake flow as `pending`. Only `review-asset` or `generation review --decision approve` can approve it. Intake fingerprints keep a changed requirement from inheriting old bytes.
- Remote output retrieval must be HTTPS to expected hosts, with redirect, loopback/link-local, content-type, size and timeout limits. Provider-returned local paths are never followed. An incompatible clip must be rejected or explicitly derived with a recorded FFmpeg command and both hashes; alpha is never invented for an opaque image.
- CI never receives provider credentials, never submits billable requests, and the fake transport has no network access.

### Provider output typing

- An operation produces exactly one media type: `text-to-image` → image, `image-to-video` and `text-to-video` → video. `transparent-layer` is an image subtype accepted only when the operation produces an image **and** the model manifest declares alpha support. A job whose declared kind is incompatible with its operation is rejected before submission.
- `bindProviderOutput` binds the result to the exact job and persisted task: a missing task id, a differing task id, an unexpected file kind, a non-HTTPS location or more than one output file all fail closed. The selection policy is `single`; an ambiguous result set is a human decision, not a default.
- A task document that reports success without a URL, reports URLs while not succeeded, carries an unknown status, or belongs to another task id is rejected. Adapter output kind is derived from the submitted operation, never hardcoded to `video`.

### Reference-image input policy

- A local filesystem path is never a provider-accessible image. `prepareReferenceInput` resolves the approved project asset, rejects links/junctions, verifies the SHA256 against the exact bytes, validates real image content (PNG IHDR / JPEG SOF, never the extension), enforces the documented size/dimension/aspect envelope, confirms the model accepts a reference, and records the identity as `asset:<id>#sha256:<12 hex>`.
- Local approval, intended reference use, explicit external disclosure and provider job execution are four separate decisions. `--authorize-disclosure` is disclosure consent for one run; `--uploads-private` records upload intent for one job. Neither implies the other.
- A reference payload exists only inside `buildReferenceDataUri`, only for `authorized-for-simulation`, and is never written to disk, logged, reported or printed. `authorized-live` is refused in this phase.
- `PRIVATE_REFERENCE_UPLOAD = NOT_GRANTED`. The upload-endpoint adapter is a typed boundary that authorises nothing and contacts nothing.
- Reference preparation supports PNG and JPEG. WebP and GIF are rejected even where a provider documents support.

### Remote media retrieval security

- Only `retrieveRemoteOutput` moves provider bytes into a project. It enforces HTTPS, no embedded credentials, default port only, no IP literals, a 2048-character limit, and a per-provider closed delivery-host allowlist. Output is not required to come from the API hostname, because signed results are served from a content-delivery domain.
- Every resolved address is screened before the request; loopback, private, carrier-grade NAT, link-local, multicast, reserved, documentation, 6to4, NAT64, unique-local and IPv4-mapped-private ranges are refused. The default resolver refuses to run; a live retrieval must inject one.
- Redirects are followed manually, bounded by policy, and every target is revalidated. A redirect without `Location` or to an off-policy host is refused.
- Downloads are streamed into `<project>/cache/retrieval/<jobId>/`, with a deadline, a running byte cap that works without `Content-Length`, a declared-length check, a truncation check, content-type agreement with the job kind, and magic-byte validation. Finalization is an atomic rename inside the project; failures remove the partial file.
- Signed result URLs are never persisted. Records keep host, path and a query-parameter count with `signedQueryRedacted: true`; simulation transcripts keep only origin and pathname.
- An expired result URL (`403`/`404`/`410`) is recoverable only by re-querying the existing provider task. Retrieval failure is never a reason to resubmit a billable generation, and is recorded with `failureKind: retrieval` so it cannot be confused with `generation`.

### Normalization and provenance

- Accepted renderers require MP4/H.264 CFR, supported dimensions, zero effective rotation and muted source audio. `inspectVideoDeep` reports container, codec, pixel format, dimensions, time base, nominal/average frame rate, sampled timestamps, rotation, duration, decode validity and audio stream count from FFprobe plus a real decode pass.
- `normalizeVideo` uses one reviewed profile (`video-normalize-v1`) and a structured argument vector. Project configuration cannot supply FFmpeg arguments, filtergraphs or shell strings. Only fps, width, height and duration vary.
- Rotation correction uses FFmpeg's documented display-matrix application (`-autorotate`), which clears the matrix on the encoded output. A hand-written `transpose` was rejected because FFmpeg 9 propagates the display matrix to the output and the renderer would still reject the file.
- The derived file is re-inspected and must satisfy container, codec, pixel format, exact dimensions, target frame rate, zero rotation, clean decode and zero audio streams. A derived duration shorter than the shot is refused.
- The provider original is never overwritten. The normalization record keeps both paths, both hashes, both inspections, the profile, the exact arguments with local paths replaced, the timing change and the frame duplication/drop policy. Derived media is never approved automatically.
- Corrupt input, undecodable codecs, dimensions outside 16–3840 × 16–2160, duration above 120 s, unusable frame rates, fewer than two frame timestamps, rotations that are not multiples of 90°, non-even target dimensions and ambiguous timing are rejected rather than approximated.

### Duplicate submission protection, retry and recovery boundaries

- The provider task id is persisted immediately after a successful submission response and before any status polling. A later resume polls that task instead of submitting, and consumes no new submission budget.
- A returned task id that conflicts with the persisted one is a hard failure. Attempt history is append-only; a later success never erases an earlier timeout.
- A submission timeout parks the job as `unknown-submission-state` with no task id and `failureKind: submission`. Any retry is refused until the remote task is reconciled. A provider task id is never invented.
- Retrieval refuses to run without a persisted task id, and refuses to run when the provider reported generation failure or cancellation. Repeated retrieval is idempotent and leaves no partial files.
- `stage` refuses to replace an approved attachment unless `--replace-approved --reason "<why>"` is passed; a replacement always lands as `review: pending`.

### Provider acceptance and CI isolation

- `npm run provider:seed` creates `synthetic-provider-image-demo`, `synthetic-provider-video-demo`, `synthetic-provider-hybrid-demo` and `synthetic-provider-guard-demo` in a fresh external workspace. `npm run provider:verify` is mandatory in Windows CI and runs entirely through injected fake transports.
- Acceptance means: simulated remote result → real local bytes → validated/normalized file → approved asset → real rendered video, with decoded frames and soundtrack inspected. A TypeScript build or a simulated API response alone is not acceptance.
- The verifier must never be conditionally skipped, never upload artifacts, and never receive credentials.

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
npm run preproduction:seed
npm run preproduction:verify
npm run preproduction -- analyze-beats --project synthetic-beat-demo
npm run preproduction -- beat-grid-candidates --project synthetic-beat-demo
npm run preproduction -- approve-beats --project synthetic-beat-demo --interpretation as-estimated --acknowledge-ambiguity --notes "<review>"
npm run preproduction -- plan --project synthetic-beat-demo
npm run handoff:seed
npm run handoff:verify
npm run generation:seed
npm run generation:verify
npm run provider:seed
npm run provider:verify
npm run preproduction -- continuity --project synthetic-mixed-timeline-demo
npm run preproduction -- tasks --project synthetic-mixed-timeline-demo
npm run preproduction -- attach-asset --project synthetic-mixed-timeline-demo --requirement REQ-001 --asset-id VID-HARBOUR --path intake/video/harbour-30fps.mp4 --provenance "<source>" --rights "<licence>"
npm run preproduction -- review-asset --project synthetic-mixed-timeline-demo --requirement REQ-001 --decision approve --notes "<review>"
npm run render:project -- --project synthetic-pixel-demo --mode video --frames 0-23
npm run render:project -- --project synthetic-module-pixel-demo --mode video --frames 0-47
npm run verify:modules
npm run audit:git
npm run audit:publication
```

Set `MV_WORKSPACE_ROOT` to a path outside this repository. Set `REMOTION_BROWSER_EXECUTABLE` or `CHROME_PATH` when Remotion cannot locate a browser. `npx remotion browser ensure` installs a managed browser for CI or a fresh host. Media fixture generation/probing and video encoding require system FFmpeg and FFprobe.

## Skill routing

- Song analysis, beat-grid evidence, annotations, lyrics, treatment, director plans, storyboards → `music-video-director`.
- Style profile, creative brief, palette, character/environment continuity, asset direction → `visual-identity-continuity`.
- AI shot contracts, asset requirement manifests, keyframes, hashes, provider authorization → `ai-shot-production`.
- Frame clock, registry, renderers, audio mixing, storyboard candidate compilation/preview → `remotion-mv-compositor`.
- Acceptance, beat/timing/storyboard/asset/compile/preview audits, PASS/FAIL/BLOCKED/NOT RUN → `music-video-quality-gate`.
- Remotion API or CLI questions → official `remotion-*` Skills.

## Agent startup

Agents that do not auto-discover `.agents/skills` must read this file and the five active Skill files explicitly. Native discovery is not universal across Codex, DeepSeek or other clients.

## Development closeout lifecycle

Every phase that changes the engine follows this order, and a phase is not complete until it does:

```text
Implementation
    ↓
Continuous AGENTS.md maintenance
    ↓
Local functional verification (real renders, not JSON only)
    ↓
Privacy/publication audit + Git media audit + actionlint
    ↓
Reviewed engine-only commit and normal push
    ↓
Remote CI completion and result verification for the exact pushed SHA
    ↓
Final Markdown report
    ↓
Local reports/ only
```

- `reports/` at the repository root is local engineering evidence. It is excluded through `.git/info/exclude` with the root-anchored rule `/reports/`, never committed, staged, pushed or uploaded as a CI artifact.
- Do not create the phase Final Report before the remote pipeline for the exact final commit SHA reaches a verified terminal result. `queued` or `in_progress` is not success, and a previous commit's green run is not evidence.
- A completed failing pipeline is `FAILED` or `PARTIALLY ACCEPTED`, not `ACCEPTED`. If the pipeline cannot be reached, report the blocker instead of writing a report that implies remote acceptance.
- Verify after writing: `git check-ignore -v --no-index reports/<file>.md` must resolve to the exclude rule, and `git ls-files -- reports` must stay empty.

## Scope boundary

The reusable engine supports declarative renderers, trusted project-local Canvas 2D scene modules, local Video/Hybrid media composition, multi-format audio ingestion, frame-locked multitrack mixing, deterministic cue analysis, a song-independent beat/section/lyrics/director/storyboard preproduction workflow, media-aware shot planning with production tasks, local asset handoff and declarative continuity. It does not start a real music-video production, generate media with AI, transcribe or fetch lyrics, migrate a private production, call providers, implement semantic music understanding, recognize visual identity in pixels, or publish production scenes. Stop before unauthorized provider, publication or production work.
