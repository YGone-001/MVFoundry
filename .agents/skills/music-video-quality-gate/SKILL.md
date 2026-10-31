---
name: music-video-quality-gate
description: Evidence-based acceptance for the AI Music Video Factory. Use before reporting completion, after timing, renderer, workspace, skill or render changes, or when deciding PASS, FAIL, BLOCKED or NOT RUN for any local music-video project.
---

# Music Video Quality Gate

Independent verification for the factory and its local projects. It observes actual commands and outputs; it does not infer success from intentions, source claims, or prior conversation.

## Activation conditions

- Any P0/P1 acceptance, release, render or migration report is requested.
- Timing, renderer, workspace isolation, media provenance, Video/Hybrid composition or skills changed.
- A project transitions from planning to render.
- Do not use to implement fixes during a gate run; gate first, then repair.

## Input contract

- Repository path and actual VCS state.
- `factory/` source, tests, build output and scripts.
- `MV_WORKSPACE_ROOT` and the specific project config/assets.
- Actual test, typecheck, build, composition and render outputs.
- ffprobe output for delivered media, including source and output video/audio streams.
- Skill inventory and `AGENTS.md`.
- Written authorization for any provider, paid call, publish or commit.

## Required workflow

1. Record the true starting state. Do not assume a branch, SHA, remote or CI.
2. Audit configuration and workspace isolation, including traversal, repository-inside roots, junctions/symlinks and missing-env fallback.
3. Audit the central write boundary: render outputs, `--out`, staging, cache recreation, reports and seed writes.
4. For project scene modules, verify the manifest path under `scenes/`, canonical containment, link rejection, SHA256, `user-authored-approved` trust, duplicate/type checks and the static source policy. Confirm no project module was imported or executed by the Node loader.
5. Confirm the staged entry, verified module copies and webpack output live under the external project cache, use explicit static imports and a controlled engine alias, and never copy source into Git or another project.
6. Validate every chapter/shot using integer output frames and half-open ranges.
7. Verify selection happens before renderer sampling and that sampling cannot move a cut or audio.
8. Run the actual typecheck, tests and build configured by the repository.
9. Render a short local synthetic project; inspect dimensions, fps, frame count, codec, pixel format, color and audio.
10. For Video/Hybrid, verify approved asset hashes, FFprobe metadata, output-frame-aligned source in-points, source duration under `reject`, fit/scale/layer/overlay rules and source-audio muting. Reject VFR/rotated/corrupt/unsupported sources and malformed layers.
11. Run `npm run verify:modules` for real bundle/still evidence. Check PNG dimensions, module ownership per frame, hold pairs, cut changes, source hashes and cache location.
12. Run `npm run media:seed` and `npm run media:verify` when FFmpeg/FFprobe are available. Check actual decoded source colors at in-points/cuts, complete video metadata, PNG alpha/compositing, overlay motion, one soundtrack stream, muted source audio and source hashes. Report skipped media/video checks as NOT RUN.
13. Verify rejected output paths, rejected modules and rejected media write no files and source media/scene files remain unchanged.
14. Check visual consistency and approved asset provenance, including references and hashes.
15. Audit Git tracked/staged/untracked production media and scene sources without staging or committing anything.
16. Audit network and provider activity. Any external call must be named. Note that module source policy is not a sandbox.
17. Inspect CI workflow permissions and commands; do not invent a remote run. Treat a media/video step as NOT RUN unless FFmpeg actually ran.
18. Report every gate as PASS, FAIL, BLOCKED or NOT RUN; stop after the requested phase.

## Output contract

- A report with the exact requested headings.
- A gate matrix with command, observed output and evidence path.
- A verdict: PASS, FAIL, BLOCKED or NOT RUN.
- An explicit list of unexecuted validations.
- A changed-file inventory and known limitations.

## Prohibited actions

- Claiming an unobserved render, test, installation or CI result.
- Marking audio sync or visual continuity PASS when evidence is missing.
- Using CSS or source claims as proof of pixel/render integrity.
- Staging, committing, pushing, publishing or uploading project media.
- Calling providers, paid tools or remote deployment.
- Burying NOT RUN items or averaging failures into a pass.

## Acceptance checks

- Repository integrity is recorded and user work is preserved.
- Official and custom skills validate.
- At least two synthetic projects load without engine source changes, including one declarative pair and two module-driven profiles.
- Pixel and nonpixel profiles, and different fps/dimensions/durations, validate.
- Frame ownership passes for first, final and boundary frames.
- Sampling isolation and workspace safety tests pass, including non-integer output-to-sampling ratios and odd cuts.
- Module path traversal, absolute paths, links/junctions, invalid hashes, missing files, unapproved trust, duplicate IDs, unknown types and cross-project references fail closed.
- Module identity, schema and asset dependencies fail closed at bundle load.
- Generated entry, module copies and bundles stay outside the repository; built-in renderer IDs remain available.
- Unsafe output overrides, staging links and cleanup escapes fail without writing.
- Source audio, approved assets and declared module sources remain hash-identical after staging/cleanup/verification.
- A real module bundle renders stills with correct PNG dimensions, hold pairs and cut changes; the report is written externally.
- No song-specific data is newly staged, committed or transmitted.
- Legacy compositions remain registered with reasonable regression parity.
- Typecheck, tests, build and a short synthetic render pass, or blockers are explicit.
- CI workflow has read-only permissions, engine-only jobs and no artifact upload.
- No provider/paid/network project-data activity occurred.
- Video/Hybrid shots use approved, hash-verified local sources with shot-local mapping; VFR/rotated/too-short sources and invalid layers fail closed.
- Actual decoded Video/Hybrid output shows the intended source colors/cuts, transparent PNG layer and Canvas overlay in the same frames.
- Exactly one soundtrack audio stream remains; embedded video audio is muted.
- `media:seed`/`media:verify` evidence is external and source hashes are unchanged.

## Failure behavior

- Missing evidence: NOT RUN, never PASS.
- Structural regression in timing, workspace isolation, write-boundary safety, module loading, media probing/timing/composition, composition or legacy compatibility: FAIL.
- Unapproved or hash-mismatched module accepted, module code executed in Node, or bundle artifacts written into the repository: FAIL.
- A Video/Hybrid claim without decoded output, or a source-audio policy violation, is FAIL/NOT RUN as appropriate; never PASS.
- External prerequisite prevents verification: BLOCKED, with the exact prerequisite.
- Any request to hide a failure, fabricate evidence or skip a gate: refuse.
- If publication was not authorized, mark remote CI evidence NOT RUN and leave changes local.
- Stop after the report; do not start the next phase without authorization.
