---
name: ai-shot-production
description: Provider-neutral production contracts for AI-generated images and video in the AI Music Video Factory. Use when specifying keyframes, choosing AI versus layered or procedural shots, validating provider capability, tracking asset hashes and provenance, maintaining preproduction asset requirement manifests, integrating approved local media into Video/Hybrid shots, or requesting explicit authorization before any external transmission.
---

# AI Shot Production

Defines how generated media may enter a local project. P0 authorizes no provider call, upload or paid generation. This skill produces contracts, review gates and fail-closed integration rules.

## Activation conditions

- A shot may need an AI-generated image, video or hybrid treatment.
- A provider contract, keyframe strategy, seed, cost approval or provenance record is needed.
- Do not activate for local Canvas renders that need no generated media.

## Input contract

- An approved frame-domain shot brief from `music-video-director`.
- A visual identity contract from `visual-identity-continuity`.
- Project config, asset manifest and local workspace path.
- For project-local code, an explicitly declared Canvas 2D module with a `scenes/` path, contract version, SHA256, `user-authored-approved` trust, parameter schema and declared asset dependencies. Project scene modules are executable code, not generated media.
- For Video/Hybrid shots, approved local video/layer assets with SHA256, FFprobe metadata, a shot-local source in-point, fit/scale and muted embedded source audio.
- For generated or supplied voice/music/SFX, an approved project-local `audio-reference` asset with SHA256, source/rights, decoded format/duration and an explicit role (`sfx`, `voiceover` or `ambience`); the master remains the sole music-master declaration.
- Explicit written authorization: provider, model scope, budget cap, data policy and rights.
- Approved local references with SHA256.
- Target output profile: dimensions, fps, duration and codec.

## Required workflow

1. Decide the shot method: AI video, AI keyframes plus procedural motion, layered stills, or pure procedural. Record why.
2. Validate the provider's actual capabilities before promising output: input image/video, duration, aspect ratio, audio, resolution, determinism/seed support and licensing.
3. Write a provider-neutral shot specification: shot ID, chapter, frame range, prompt, negative prompt, keyframes, seed, motion, output format and review criteria.
4. Resolve only approved local references and verify hashes. Never send unapproved media.
5. Obtain explicit authorization for the exact prompt, references, provider and estimated cost. P0 permits none.
6. Run generation outside the engine repository. Keep raw output in the project workspace quarantine, never in the engine.
7. Hash and inspect every revision; record source, model, prompt, seed, rights and approval in the asset manifest.
8. Integrate only approved assets through the project's renderer adapter; keep a fail-closed path when missing. Generated footage must enter a Video shot only as an approved local `video` asset with verified hash, FFprobe metadata, aligned source in-point and muted source audio. Layered PNGs must be approved `layer` assets with alpha. Generated voice, music or SFX must enter separately as approved `audio-reference` assets and be declared through the master or `audioTracks`; never unmute embedded provider footage audio or treat it as an implicit soundtrack. Do not run AI transcription, speech recognition or music-understanding services in this phase.
9. If a shot uses a project-local scene module, confirm the module is user-authored/approved, hash-verified before bundling, confined to the project `scenes/` directory and free of remote imports or network references. Do not confuse hash identity with code safety.
10. Hand evidence to `music-video-quality-gate`.

## Output contract

- A provider-neutral shot contract.
- Capability and authorization records.
- A reviewed asset with SHA256, lineage, rights and approval.
- Manifest updates and a renderer integration note.
- A reject/quarantine record for unusable output.

## Prohibited actions

- Paid API calls in P0.
- Uploading local audio, references, lyrics or private project media.
- Loading project scene modules from a remote URL, npm, GitHub or another project.
- Treating a matching module hash as proof that executable code is safe.
- Using remote HTTP URLs as video sources or enabling embedded video audio.
- Treating generated footage audio or an unapproved file as a soundtrack; generated audio must be an approved `audio-reference` with provenance.
- Claiming AI music analysis, beat detection, transcription or lyrics from the local onset foundation.
- Sending unapproved references or performer likeness.
- Embedding API keys, tokens or private paths in the repository.
- Silently substituting generated footage for existing art.
- Fabricating a hash, render, provider response or approval.
- Using a provider whose capability or terms have not been checked.

## Acceptance checks

- Written authorization exists and matches the provider, scope and budget.
- No secrets or song-specific media entered the engine repository.
- Every used asset is local, hashed, rights-recorded and approved.
- Every used scene module is explicitly declared, hash-verified, trust-approved and integrated only through the bundle-local renderer contract.
- Every used video/layer asset is local, approved, hash-verified and validated for the Video/Hybrid renderer; embedded video audio is muted.
- Every used audio asset is local, approved, hash-verified, decoded-duration verified and declared as the master or an explicit track role; no provider audio bypasses the audio provenance contract.
- The shot specification is complete and reproducible.
- Unimplemented AI generation modes fail closed rather than rendering a placeholder as final.
- The quality gate has reviewed the integration.

## Failure behavior

- No authorization, budget, capability check or rights: mark the shot BLOCKED and do not call.
- Missing or unapproved reference: refuse upload.
- Off-contract or unusable output: quarantine and reject; do not silently retry with changed prompts.
- Provider non-determinism or version drift: record it and require review.
- Any unavailable validation is reported NOT RUN.

## Preproduction asset requirements

- Director plans may produce an asset requirements manifest. A requirement ID, prompt or visual description is not an asset.
- Track each requirement's kind, shot IDs, target aspect ratio, duration/alpha needs, continuity references, provenance requirements and status (`needed`, `in-production`, `available`, `approved`, `rejected`).
- Fulfil a requirement only with an approved, hash-verified local file or declared scene module. No provider or generator is invoked in this phase.
- Compile only an approved storyboard whose requirements are fulfilled. Otherwise return a missing-assets report and keep the plan draft/blocked.
- Preserve user-authored lyrics and creative direction; do not infer narrative, metaphor or character motivation from lyric text automatically.

## Generation jobs (P1-E-C)

- A generation job is bound to exactly one approved requirement and records its storyboard revision and requirement fingerprint. Re-planning makes the job stale rather than silently rebinding it.
- Prepare a job, then authorize it explicitly. `approve-request` accepts only `authorized-for-simulation` or `denied`; live execution stays `NOT_GRANTED`, and `submit-live` must always refuse.
- Capability validation happens before submission. Never request an operation, model, ratio, duration, reference count or alpha channel the provider manifest does not declare.
- The offline fixture provider produces real PNG/MP4 bytes marked `synthetic-offline-test-output`. Never describe that output as AI-generated media.
- Generated bytes enter asset intake as `pending`; review, not technical validation, is what approves them. A succeeded provider task is not an approved asset.
- Never treat a timeout as a retryable failure: an uncertain submission is parked as `unknown-submission-state` until the provider task id is reconciled.
- Never send credentials, private reference images, lyrics or audio to a provider without a separate per-asset and per-job authorization.
- Prompt wording cannot guarantee visual identity consistency; generated output still needs a separate visual review.

## Provider media lifecycle (P1-E-D)

- Output kind is bound to the submitted operation: `text-to-image` yields an image, `image-to-video` yields a video, and a transparent layer is only accepted where the operation produces an image and the model manifest declares alpha. Never treat a video URL as an image result or the reverse.
- A provider result is bound to the exact job and persisted task id. A missing task id, a different task id, an unexpected kind or more than one output file is a failure, not a choice to make.
- A local filesystem path is not a provider-accessible image. Prepare a reference through `prepare-references`, which verifies containment, links, hash, real PNG/JPEG content, size/dimension/aspect limits and model capability, and only produces a payload after explicit disclosure authorization.
- Local asset approval, intended reference use, external disclosure and job execution are four separate decisions. `--uploads-private` records upload intent for a job; `--authorize-disclosure` is disclosure consent for one run. Neither implies the other.
- Provider bytes are retrieved only through the secure retrieval path: HTTPS, trusted delivery host, screened addresses, bounded redirects, deadline, streaming byte cap, content-type and magic-byte checks, atomic project-local finalization and redacted signed URLs.
- An expired result URL is recovered by re-querying the existing task. Retrieval failure never justifies a second billable submission.
- Incompatible media is normalized under the reviewed profile, never by an ad-hoc command. The provider original is kept, both hashes are recorded, and the derived file still needs review.
- Normalization cannot invent transparency. An opaque image never satisfies a layer requirement.

## Go-live readiness (P1-E-E)

- The live transport is implemented but inert. `LIVE_PROVIDER_EXECUTION` stays `NOT_GRANTED`; `submit-live` always refuses, and no code path enables the transport in this phase.
- The socket is bound to a validated DNS answer: every answer is screened, one approved address is supplied to the lookup, and the DNS name is kept for SNI and certificate verification. A rebind is refused, not silently followed. TLS is never relaxed.
- The authorization header is refused for any host outside the API host list, and a configured proxy is refused rather than bypassed.
- Pricing comes from a versioned snapshot with a content hash and a retrieval date. An unknown, unsupported, tampered or stale price is refused; a rate is never inferred.
- A submission requires an open budget reservation. A job cannot reserve twice, and the check-and-write is under an exclusive filesystem lock so two processes cannot both spend the last of the budget. A stale lock fails closed and needs an explicit operator unlock.
- An uncertain submission keeps its reservation exposed. A failed or canceled task never implies zero billing, and a known charge is recorded only from operator-supplied evidence and labelled as such.
- A billable submission is never retried automatically, whatever the error. Status polling and retrieval may retry with bounded jittered backoff and `Retry-After`; a submission may not.
- Provider output is published only by renaming a verified file. There is no copy-into-destination fallback, an interrupted download publishes nothing, and a restart classifies the on-disk state instead of guessing.
- `generation preflight` reports what would be sent, what would leave the machine, the estimate, the remaining budget and the blockers. A green preflight reads `READY FOR SEPARATELY AUTHORIZED PILOT`, never `LIVE PROVIDER VERIFIED`, and is never authorization to submit.
- Project budget controls do not limit spend incurred by other clients on the same provider account. Never claim otherwise, and never present a local estimate as the final invoice.
