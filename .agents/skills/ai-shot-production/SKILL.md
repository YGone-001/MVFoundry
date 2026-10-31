---
name: ai-shot-production
description: Provider-neutral production contracts for AI-generated images and video in the AI Music Video Factory. Use when specifying keyframes, choosing AI versus layered or procedural shots, validating provider capability, tracking asset hashes and provenance, integrating approved local generated media into Video/Hybrid shots, or requesting explicit authorization before any external transmission.
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
