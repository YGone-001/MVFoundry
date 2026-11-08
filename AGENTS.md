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
- `npm run golive:seed` and `npm run golive:verify` are the go-live readiness suite: pricing, spend reservations, cross-process concurrency, transport policy, retrieval finalization, crash recovery, operator preflight and a full generation-to-render regression. Both are mandatory in Windows CI and are never conditionally skipped.
- `npm run pilot:seed` and `npm run pilot:verify` are the pilot-admission suite: ordinary P0 refusals, admission binding and revocation, one-shot ownership under two operating-system processes, the fake-provider lifecycle to a real rendered MP4, and the transport wiring against a controlled local HTTPS server. Both are mandatory in Windows CI and are never conditionally skipped. The suite receives no credential: it sets a recognisable placeholder and asserts it never appears in any output.
- Acceptance means: simulated remote result → real local bytes → validated/normalized file → approved asset → real rendered video, with decoded frames and soundtrack inspected. A TypeScript build or a simulated API response alone is not acceptance.
- The verifier must never be conditionally skipped, never upload artifacts, and never receive credentials.

### Network transport trust

- `factory/src/generation/transport.ts` is the only executable network path. It is inert unless `liveExecutionEnabled` is explicitly true, and no code in this phase sets it. `LIVE_PROVIDER_EXECUTION` remains `NOT_GRANTED`.
- A request is only permitted to a host named in the provider endpoint policy. The API host and the signed-output delivery hosts are different trust domains: the authorization header is refused for any host outside `authorizationHosts`.
- DNS answers are resolved through an injected resolver and screened by an injected address classifier. Every answer must pass; a mixed public/private answer is refused rather than narrowed to the public one.
- The socket is bound to the validated address by a `lookup` that ignores the hostname it is given. The DNS name is kept as `servername` so SNI and certificate verification still apply to the original hostname. A rebind cannot silently replace the approved address because no second resolution happens during connect.
- TLS is never relaxed: `rejectUnauthorized` is always true, the minimum version is TLS 1.2, and the system trust store is used unless a test injects extra anchors. Do not add a verification bypass.
- Redirects are never followed by the transport. A 3xx is reported to the caller, and the retrieval path applies its own bounded, revalidated redirect policy.
- A configured environment proxy is refused. A proxy resolves the destination itself, so the validated-address binding cannot be guaranteed. Proxy support is not implemented and must not be claimed.
- Connection and response deadlines are separate: the connect deadline covers TCP plus the TLS handshake, and the response deadline starts once the socket is secure.
- Do not claim DNS-rebinding resistance beyond what the binding test shows: the address is validated and bound per request, and the test suite proves a rebind to a private address is refused.

### Provider pricing and spend control

- `factory/src/generation/pricing.ts` holds a versioned snapshot transcribed from the published pricing page, with a content hash, a retrieval date and explicit caveats. A snapshot that fails its hash or exceeds its maximum age is refused.
- Model capability and model pricing stay separate: capability manifests say what a model can do, the pricing snapshot says what it costs. An unknown or explicitly unsupported model is refused; a rate is never inferred.
- A local estimate is an upper bound for the documented tariff. It is never a guarantee of the invoice, and tax, discounts, promotions and other clients on the same account are outside the engine's visibility.
- `factory/src/generation/ledger.ts` is the only spend authority. A submission requires an open reservation, a job cannot reserve twice, and the check-and-write happens under an exclusive filesystem lock so two processes cannot both consume the last of the budget.
- A stale lock is never removed silently. It fails closed and needs `generation ledger-unlock --confirm`, which records the intervention in the ledger document.
- An uncertain submission keeps its reservation exposed; a failed or canceled task never implies zero billing. A known charge is only recorded from operator-supplied evidence and is labelled `user-entered` or `provider-reported`, never presented as verified by MVFoundry.
- Project-level budget controls do not limit spend incurred by other clients on the same provider account. Never claim otherwise.

### Retry and billable-request safety

- `factory/src/generation/retry.ts` is the single retry decision point. A billable submission is never retried automatically, whatever the error: an uncertain POST may already have created a paid task.
- Status polling and output retrieval may retry with bounded exponential backoff and up to 50% jitter, honouring a valid `Retry-After`. Authentication, validation, redirect, TLS and address failures are never retried.
- Another billable submission is only possible after the previous task state has been conclusively reconciled and a separate authorization permits it.

### Atomic media persistence and recovery

- A downloaded provider result is streamed into task-owned scratch space, hashed while streaming, and published only by renaming a file whose size and SHA256 were verified. There is no copy-into-destination fallback.
- If an atomic rename is impossible, the file is staged and verified inside the destination directory and then renamed. A failure removes every partial artefact and publishes nothing.
- An existing finalized output is reused only when its hash matches. A different output at the same path is refused unless an explicit replacement was authorized.
- `generation/state/<jobId>.json` records the finalization phase, and `generation retrieval-state` classifies what a restart finds: no media, incomplete temporary file, downloaded-but-not-finalized, finalized-but-not-manifested, finalized-awaiting-review, or approved. Contradictory evidence is `ambiguous` and fails closed.
- A failed recovery never creates an approved-looking output, and a download failure never justifies resubmitting a billable generation.

### Operator preflight

- `generation preflight` answers what would be sent, which model and assets would leave the machine, whether disclosure is authorized, the estimated maximum charge, the remaining budget, the submission limit, capability compliance, transport readiness, credential presence (never the value), requirement currency and whether the job is already submitted.
- A green technical preflight is not authorization. The report always states `liveExecution: NOT_GRANTED` and derives `submissionAuthorized` from every gate, so it is false in this phase. A passing technical result reads `READY FOR SEPARATELY AUTHORIZED PILOT`, never `LIVE PROVIDER VERIFIED`.
- Project permission flags (`externalGeneration`, `localOnly`, `allowNetwork`) are reported as a separate policy gate. The engine forbids enabling them. A pilot admission is an overlay evaluated at the submission boundary; it never changes `project.json` and never relaxes P0 for another project or job.

### Pilot policy admission and one-shot execution

- P0 stays the default-deny boundary. `validateProjectConfig` continues to reject `externalGeneration: true`, `localOnly: false` and `allowNetwork: true`, and no project field can express pilot mode. The effective policy is computed only at the submission boundary (`factory/src/generation/pilotAdmission.ts`), never by the project validator.
- A pilot admission is a project-local, reviewed, single-use record (`generation/pilot-admission.json`) that binds one pilot id to one project, job, requirement id and fingerprint, storyboard revision, provider, model, operation, output profile, pricing snapshot identity, maximum estimated cost, spend ceiling, exactly one submission, and an exact reference set with a per-reference `uploadAuthorized` decision.
- The record must not contain credentials, bearer tokens, signed URLs, raw payloads, private absolute paths, song audio or lyrics. `parsePilotAdmissionDocument` rejects those keys and values structurally, so a future field cannot smuggle them in.
- An admission is local operational evidence. Never describe it as authenticated approval, cryptographic identity verification, billing control or a provider-side authorization.
- Staleness fails closed: a changed project, job, requirement fingerprint, storyboard revision, model, operation, output profile, reference hash, pricing snapshot, expiry, revocation or consumption refuses the admission with a stable refusal code. Nothing renews silently; a new attempt requires a new pilot id.
- Technical readiness, policy admission, budget reservation, reference disclosure, live-execution authorization and submission state are reported as separate fields. `submissionAuthorized` is derived from all of them and cannot be true while live execution is not granted.
- `LIVE_PROVIDER_EXECUTION_GRANTED` in `factory/src/generation/submission.ts` is `false`. `pilot-submit` always refuses at the live-authorization gate and does not consume the admission. Flipping that constant is a separately authorized engine change, not a configuration option; no environment variable, project field or admission record can set it.
- Submission ownership is taken inside the project ledger lock (`consumePilotAdmission`), so exactly one local process can consume an admission. The losing process refuses before any provider call, and a job can never hold two reservations.
- A job is submitted at most once. The provider task id is persisted before any polling. A failure after the request may have been transmitted parks the job as `unknown-submission-state` and the admission as `uncertain`; neither is released automatically and no retry is permitted without reconciliation.
- Only a failure decided before a socket is opened may return an admission to `unconsumed`; that closed set lives in `submissionFailureTransmitted`. Everything else is treated as financially exposed.
- A conflicting provider task id is a hard failure, never a silent rebind.
- Reference disclosure is recorded per reference. A reviewed admission that authorizes every reference is the disclosure decision for that pilot; `generation prepare-references --authorize-disclosure` remains the generic, non-pilot switch.
- The live transport stays closed: the submission boundary accepts only an injected `simulated` grant with a simulated driver. The acceptance suite drives the real adapter and the real secure transport against a controlled local HTTPS server, and proves the same transport refuses every request while the gate is closed.
- `npm run pilot:seed` and `npm run pilot:verify` are mandatory in Windows CI and are never conditionally skipped. They cover ordinary P0 refusals, admission binding and revocation, one-shot consumption under two operating-system processes, the fake-provider lifecycle to a real rendered MP4 with decoded frames and soundtrack, and the transport wiring.

### Complete music-video production

- `npm run mv:seed` creates `synthetic-mv-signal-garden` in a disposable external workspace: a 60-second original score (generated by `factory/scripts/support/synthetic-score.mjs`), six musical sections, fifteen shots spanning all four renderer families, one project-local TS scene module, and synthetic clips, transparent layers and a reference plate. No song, recording or third-party media is involved.
- `npm run produce-mv` (script `factory/scripts/produce-mv.mjs`) is the production orchestration: validate the audio hash and decoded duration, stage and review assets through the accepted handoff workflow, verify every bound hash, compile the approved storyboard, render the full timeline through `render-project.mjs`, then inspect the actual file. A zero FFmpeg exit is not acceptance.
- The master audio is the duration authority. The video covers `[0, durationInFrames)`; audio is sliced from the same approved mix and muxed once. The frame sequence is numbered with four digits because a 60-second master at 24 fps is 1440 frames, which a `%03d` pattern would truncate at 999.
- Assets are delivered, hashed, probed, staged as pending intake and then explicitly reviewed. A rejected asset never enters a render and is never replaced automatically; the rejected record is kept in project-local evidence, and the replacement needs a fresh review.
- `compile` validates the candidate against engine-registered renderer kinds only. The project's own module kinds are validated separately by the config validator; passing them in as "protected" made every module project collide with itself. Do not reintroduce that.
- `factory/scripts/verify-mv-production.mjs` is the complete-MV acceptance verifier. Passing means: real codec, pixel format, dimensions, frame rate and frame count; one AAC soundtrack that covers the full duration; every approved shot boundary is a visible cut; in-shot motion is smaller than the smallest cut; Video shots decode to their source clip at the declared in-point; Hybrid shots show a measurable layer contribution; the module renders a dark ground; each musical section has a real energy profile; rhythmic markers survive the mix; and no embedded source audio leaked.
- The review package under `<project>/reports/review-package/` separates three decisions: technical acceptance (automated), visual continuity (human, with a checklist) and artistic quality (human, unchecked). Never mark artistic quality as accepted because the file is structurally valid.
- CI runs `npm run mv:seed` and `npm run mv:verify -- --profile ci --produce`: the same approved storyboard and full 1440-frame duration at half resolution, documented as the CI profile. A short smoke render may be added but never replaces the full-duration verification.
- Generated audio, clips, layers, renders, contact sheets and review packages stay in the external workspace and are never committed.

### Generic MV production (P1-F-B)

- `factory/scripts/mv-project.mjs init` creates a new project in an authorized external workspace from explicit inputs (project id, output profile, one selected local audio source with declared provenance and rights). It validates the project id, rejects collisions and engine-root destinations, verifies the audio format and decoded duration, copies the source byte-for-byte, and records SHA256 plus the rights assertion. A user-declared rights assertion is an operational record, not independent verification of copyright ownership.
- `factory/scripts/mv-project.mjs import-audio` imports or explicitly replaces the master audio. Re-importing an identical source is idempotent; a changed hash requires `--replace` and never silently rewrites approved timing.
- `produce-mv.mjs` is project-independent: it reads the project's actual state, validates the approved storyboard and every bound asset hash, compiles a candidate, renders the full timeline and inspects the output. It never approves an asset, asserts rights, substitutes a file or generates anything. Missing or unreviewed assets produce a structured `BLOCKED` result with precise blockers.
- The Signal Garden fixture asset map (`support/mv-assets.mjs`) is synthetic-rehearsal-only and is reached only via the explicit `--stage-fixture-assets` flag. A normal production run never touches it.
- Production idempotency: an existing accepted output for the same storyboard revision and asset hashes is not silently overwritten; `--rerender` or a new revision is required.
- `seed-mv-project-b.mjs` + `verify-mv-project-b.mjs` create and accept an independent second project ("Prism Transit") with different duration (50s), meter (5/4), tempo changes, nonuniform shots, 4:3 output and a different renderer distribution — proving the engine has no hardcoded project assumptions.
- Timeline regression assertions (A9–A11) in `verify-mv-production.mjs` detect divergent section boundaries and renderer mappings between score, annotations, storyboard and candidate.
- A verifier's selected `--profile` is forwarded to every production subprocess through one central argument list, never re-declared at individual call sites. A duplicate `--profile` is refused as a contradiction, and a caller may add options but never a second profile. The profile selected for the run is the profile the evidence, the output filename and the decoded acceptance must all describe; there is no master fallback for a missing CI artifact.
- Production evidence and the rendered file must agree on the profile. `verify-mv-project-b.mjs` therefore asserts that the evidence names the profile's own output file and expected dimensions, and that the file itself is H.264 / yuv420p at the exact profile dimensions, at the project frame rate, with the exact frame count and container duration.
- Missing media or evidence fails mandatory acceptance; it never shrinks the check list. Every decoded check is emitted exactly once per run, so an absent artifact produces explicit failures rather than a shorter, greener result. A green verdict is only possible when every mandatory decoded check actually ran.
- `verify-mv-project-b.mjs` proves that invariant on itself with two negative controls: the real D2/D3/D4/E1–E5 evaluation is re-run against a directory with no production evidence (all eight must fail), and against a directory whose evidence belongs to the other profile (the otherwise well-formed evidence must still be rejected by the profile and media checks). Windows CI runs the independent project at full duration in the CI profile, so the decoded checks are mandatory remotely, not only locally.

### Publication audit

- `security/audit-publication.mjs` supports two evidence modes: `filesystem` (working tree) and `--candidate` (the exact tracked publication set from `git ls-files`).
- Untracked local tool directories are skipped and reported in `skippedLocalToolDirs`, never hidden. A directory that contains any tracked file is a finding, not a skip.
- Secret scanning, absolute-path scanning, unexpected-URL-host scanning, media rejection and the allowlist checks are unchanged by that exclusion.
- `.workbuddy-ai/` is local agent state: it must never be tracked, staged, committed or included in the publication inventory.
- Root `.opencode/` uses that same local-tool rule only: report an untracked directory as skipped, reject tracked or staged content, and reject directory links/junctions before considering the skip. Nested `.opencode/` and other unknown hidden directories receive the normal audit. Filesystem mode observes local state; candidate mode checks the exact Git publication set and must still reject local-tool content in it.


### Creator onboarding, offline browser readiness and still-image intake

- `mv-project.mjs init` writes a project with no render timeline (`chapters: []`). Preproduction tooling therefore loads a project with the explicit preproduction stage (`stage: 'preproduction'`), which accepts an empty timeline so analysis and planning can begin immediately. The render path keeps the default stage and a project without a complete, contiguous, approved shot timeline still cannot be rendered. The relaxed stage never weakens audio hash/duration, asset, permission or workspace validation, and it never invents a placeholder shot or an approval.
- Ordinary still images are `kind: "image"` and accept 8-bit RGB, RGBA, grayscale and grayscale-alpha PNG data; transparency is optional and only reported. Transparent layers are `kind: "layer"` and still require an alpha-capable PNG (colour type 4 or 6). The same opaque PNG that is valid as an image must be refused as a layer, and a JPEG or corrupt/truncated file must be refused by both.
- Palette (colour type 3) and 16-bit PNG data are refused rather than approximated, and JPEG intake is not implemented; do not document support for formats the engine does not probe. Decoder compatibility is proven by an actual render, never by the header probe alone.
- `attach-asset` never approves anything: a record lands as `review: "pending"` and only `review-asset` can approve or reject it. `report-assets` keeps returning a non-zero exit while requirements are unresolved.
- Rendering resolves the browser before staging, mixing, bundling or any frame work. `checkRenderBrowser` wraps Remotion's `ensureBrowser` with a download callback that throws, so a host without a usable browser is refused (`BROWSER_MISSING`, `BROWSER_PROVISIONING_NOT_AUTHORIZED`, `BROWSER_EXECUTABLE_INVALID`, `BROWSER_VERSION_UNSUPPORTED`) instead of silently downloading one. The selected browser source and executable are recorded in the render report. A missing browser is a setup refusal, not a compositor failure, and `mv:workflow` reports it as `BROWSER_NOT_READY`.
- No engine code sets, clears or relies on `NODE_TLS_REJECT_UNAUTHORIZED`. When the host exports `0`, the render path reports a warning; the transport keeps its explicit `rejectUnauthorized: true` and certificate verification is never disabled. Correcting that variable is not a fix for a missing local browser.
- Command-line text is owned by the parent shell's encoding. Non-ASCII song titles, artist names, provenance and rights statements are supplied with `--metadata-file <utf8-json>`: the document is decoded as strict UTF-8, unknown keys are rejected, and a field declared twice with differing values is refused. The engine never scans folders for metadata.
- `layered-canvas` keeps its historical grade exactly when the per-shot `washTop`, `washBottom`, `overlayOpacity`, `lineOpacity` and `grainOpacity` parameters are omitted (0.18, 0.55, 0.22, 0.6, 0.08). An explicit low-wash configuration preserves more of the creator image's colour; it never changes timing, audio, asset identity, source hashes or renderer family, and a measured saturation increase is not an artistic approval.

### Visual styles and renderer backends

- Visual style, rendering backend and asset production are separate concepts. A style is a visual language, not a renderer and not a palette. All six registered P1-G-A styles currently execute on Canvas 2D and must produce structurally different images.
- `factory/src/style/catalog.ts` is the style registry; `factory/src/style/themes.ts` owns optional role themes. `visual.style` is optional and legacy projects keep `visual.styleProfile` unchanged. There is no breaking schema migration.
- A style-driven project may mix project Canvas modules with style-declared media renderers. `sceneModules[].styleIds` declares the project capability and the module export must declare matching `supportedStyles`; a mismatch fails closed at bundle bind. A media renderer is allowed only when the selected style declares that route in `mediaRoutes`; the catalog never assumes approved footage is compatible with every style.
- The module render context receives a frozen `style` object with the active id, label, optional theme roles and the full profile. Legacy modules receive `null`; the engine never invents a default style.
- `canvas.mode: output` is full-resolution Canvas 2D; `project-pixel` keeps integer pixels and hold-based sampling. Changing `visual.style.id` must change actual output, not only metadata.
- `svg`, `html` and `three` are `BLOCKED_CAPABILITY` in this phase: no reviewed SVG/HTML contract or sanitizer and no WebGL determinism/headless policy. A compatible-backend label never implies an implemented backend, and a blocked backend must not be selectable.
- `footage-hybrid` remains the approved video/layer production route. `video` and `hybrid` are now style-bound when the style declares them; `retro-pixel` declares no media route at all, so it refuses footage instead of silently grading it.
- `parallax-2p5d` is the asset-backed 2.5D compositor. It composes one approved opaque plate (`image` or `video`) with RGBA `layer` cutouts on explicit depth roles, a deterministic normalized camera path, atmosphere, light variation, style-derived grade and optional comic treatment. It extends the existing renderer registry and the existing asset kinds; it does not add a second asset system and does not replace Canvas modules.
- Depth is a contract, not a claim: validation requires an opaque background plate, at least one midground and one foreground layer, role-ordered draw order, per-role parallax ranges, a depth span of at least 0.25, bounded camera amplitude and bounded layer translation. The renderer multiplies camera displacement by each layer's `parallax`, so layers always move by different amounts under the same camera move.
- Background plates are PNG-probed only on projects that use the 2.5D route. Layer assets must be alpha-capable PNGs and can never stand in for an opaque plate. Every source stays declared in the project manifest, hash-verified, staged through the write boundary, and rejected on traversal, links or escapes.
- The integer output-frame clock remains the only timeline authority; the project audio mix remains the only audio authority. Camera, layer motion and light variation are sampled from the shot-local frame, and comic motion quantisation uses integer arithmetic, so the same frame always produces the same image.
- Unknown styles, unsupported style/backend combinations, missing media, wrong asset kinds, unapproved assets, stale hashes, unaligned source in-points, wrong depth order and missing depth tiers fail closed before any output file is written.
- `npm run style:media:verify` is the bounded CI regression. It renders a styled Canvas shot, a Video shot, a Hybrid shot and a 2.5D shot in one synthetic project, measures decoded per-depth stripe displacement, decodes a short MP4 for codec, size, fps, frame count, pixel format and audio-stream count, and proves four negative controls write nothing.
- `npm run style:art`, `npm run style:prototype:seed` and `npm run style:review` reproduce the local artistic prototypes and the human review package. The prototypes prove that the compositor works and that two visual languages read differently; they do not establish artistic approval. The verdict stays `PENDING_HUMAN_REVIEW` until the creator reviews the actual clips.
- `npm run style:verify` creates a disposable synthetic project, renders two styles through the same module, compares decoded raw pixels, checks deterministic repeats and verifies unknown-style refusal with no output file. A full gallery or a valid still does not establish human artistic approval.
- The six-style gallery, boards, frames, videos and quality records stay in the external workspace. Missing fidelity must be disclosed (`BLOCKED_CAPABILITY` or an asset limitation), never replaced by a style label.

### Timeline and rendering

- Integer output frames are the canonical editing clock; scene ranges are half-open `[startFrame, endFrame)`.
- Resolve the shot from the raw output frame before applying renderer sampling.
- Renderer sampling is local to the selected renderer. Use `floor(localFrame * samplingFps / outputFps)`; never quantize before selection.
- Video/Hybrid media playback is inside a shot-local Sequence; Remotion `trimBefore` is in composition-frame units.
- The approved master duration and integer output-frame clock are authoritative; audio samples map to frames through the documented rounding policy and are never retimed by animation sampling.
- Do not make one song's duration, scene count, resolution, fps or pixel profile a global constant.
- Local rendering uses Remotion `renderFrames` plus system FFmpeg in the current environment.
- Render refusal precedence is CLI/project validation, still-frame bounds, write-boundary creation and destination resolution, then offline browser readiness. Boundary creation and destination resolution do not create directories. Only `BROWSER_READY` permits report/cache directories, staging, audio mixing, bundling and frame work. Invalid destinations and still frames must never be masked by browser setup errors.
- Browser detection never installs Chromium implicitly. Deterministic CLI regressions use a nonexistent explicit executable even on hosts with a managed browser cached: invalid outputs/frames win, and valid requests return exit 3 with `BROWSER_EXECUTABLE_INVALID`, leaving all project paths and source hashes unchanged. Controlled offline injection separately tests `BROWSER_MISSING` and `BROWSER_PROVISIONING_NOT_AUTHORIZED`; those statuses are not interchangeable.
- The default project load remains strict for rendering and compiled previews. Only `stage: 'preproduction'` allows a fresh `chapters: []` project for analysis/planning; audio, assets, hashes, workspace and P0 permissions stay validated. Compilation still requires an approved storyboard with fulfilled requirements and validates its complete candidate timeline; producers and workflow previews pass through those gates before strict render loading.
- Windows CI must run unit tests before explicit browser provisioning, and must execute the full 30-second/900-frame onboarding verification, both complete-MV suites and the workflow verifier. A skipped mandatory step is not acceptance. Closeout requires terminal CI and actual step conclusions for the exact pushed SHA before writing the excluded local Final Report under `reports/`.

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

- Human-guided operator entrypoint: `npm run mv:workflow -- help`. Status is read-only; technical readiness never grants artistic approval. Explicit `--revision N --draft` selects a draft for preview. `--frames A:B` is half-open, unlike the underlying renderer's inclusive range.
- Workflow previews use the existing render CLI and authoritative PCM mix slice for exactly `[A,B)`. Preview evidence binds the storyboard content/revision, project inputs, reviewed intake, continuity and source hashes. Existing output files are refused; project.json and approved source bytes are immutable.
- `edit-shot` creates a separate draft in the existing preproduction revision directory. It validates coverage and renderer contracts, changes only the selected shot, and refuses revision collisions. `approve-revision` is explicit technical promotion, recorded separately from artistic review. Historical draft bytes remain unchanged.
- Creative review decisions are accept, request-changes, reject and not-reviewed; negative decisions require notes. Synthetic test actions are labelled and never establish human artistic approval. Changed source/revision/output fingerprints make old reviews stale. Reviewer identity is not authenticated.
- Full-render readiness requires approved timing, brief, director plan and storyboard, fulfilled approved assets, valid continuity, verified modules and normal loader validation. Review packages remain external and contain decoded output stills.
- `workflow:verify` is a mandatory Windows CI step after both complete-MV suites. It uses real nonzero-range previews, decoded PCM comparison, targeted drafts, stale-review refusal and a full corrected render in a fresh synthetic copy. Test reviews are explicitly synthetic. Existing full-project CI steps may not be replaced with previews.
- F2 investigation: the baseline and fresh-copy explicit rerenders passed locally; the earlier transient was not reproduced and no root cause is asserted. Preserve the render retry default (one attempt); explicit `--retry` is validated as 1–5 attempts. Capture exit/signal/stderr, filesystem/encoder/timeout or unclassified render failure, output state and source hashes. An injected browser failure with two attempts must leave accepted evidence/output unchanged. This diagnostic control is not a reproduction of the historical transient.
- A separate local pilot-suite run using installed Chrome produced a compositor frame-extraction error. Its staged clip hash matched and FFmpeg decoded the requested timestamp; no final output was published. An isolated render using Remotion's managed browser passed. Keep that failure distinct from the historical F2 event; browser choice or concurrency has not been established as its cause. Provision the managed Remotion browser and OpenSSL as CI does before acceptance.
- The producer refuses stale-output replacement without explicit rerender/new filename, verifies output hashes for idempotency, and retains previous production evidence under project-local `reports/production-history/`. Preview and review evidence never overwrite earlier records. Status may read/probe media but never writes or approves it.
- Final reporting follows the closeout lifecycle below: review explicit engine source paths, pass local gates/privacy audits/actionlint, create only the authorized forward-only commit, push normally, inspect terminal CI steps for that exact SHA, then write the excluded local Final Report. Never use an earlier CI run or synthetic artistic reviews as acceptance evidence.

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
npm run golive:seed
npm run golive:verify
npm run pilot:seed
npm run pilot:verify
npm run mv:seed
npm run mv:produce -- --project synthetic-mv-signal-garden
npm run mv:verify -- --project synthetic-mv-signal-garden
npm run mv:verify -- --profile ci --produce
npm run onboarding:seed
npm run onboarding:verify
npm run preproduction -- continuity --project synthetic-mixed-timeline-demo
npm run preproduction -- tasks --project synthetic-mixed-timeline-demo
npm run preproduction -- attach-asset --project synthetic-mixed-timeline-demo --requirement REQ-001 --asset-id VID-HARBOUR --path intake/video/harbour-30fps.mp4 --provenance "<source>" --rights "<licence>"
npm run preproduction -- review-asset --project synthetic-mixed-timeline-demo --requirement REQ-001 --decision approve --notes "<review>"
npm run render:project -- --project synthetic-pixel-demo --mode video --frames 0-23
npm run render:project -- --project synthetic-module-pixel-demo --mode video --frames 0-47
npm run style -- list
npm run style -- inspect --id cinematic-illustration-2p5d
npm run style -- check --project synthetic-module-pixel-demo --workspace <external-workspace>
npm run style:verify
npm run style:media:verify
npm run style:art -- --workspace <external-workspace> --project <style-project> --set cinematic|anime
npm run style:prototype:seed -- --workspace <external-workspace> --project <style-project> --set cinematic|anime
npm run render:project -- --project <style-project> --mode video --frames 0-359
npm run style:review -- --workspace <external-workspace>
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

The reusable engine supports declarative renderers, a validated visual-style catalog with optional themes, trusted project-local Canvas 2D scene modules, local Video/Hybrid media composition, multi-format audio ingestion, frame-locked multitrack mixing, deterministic cue analysis, a song-independent beat/section/lyrics/director/storyboard preproduction workflow, media-aware shot planning with production tasks, local asset handoff and declarative continuity. It does not start a real music-video production, generate media with AI, transcribe or fetch lyrics, migrate a private production, call providers, implement semantic music understanding, recognize visual identity in pixels, or publish production scenes. Stop before unauthorized provider, publication or production work.
