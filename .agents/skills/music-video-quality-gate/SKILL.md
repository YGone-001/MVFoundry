---
name: music-video-quality-gate
description: Evidence-based acceptance for the AI Music Video Factory. Use before reporting completion, after timing, renderer, workspace, skill or render changes, or when deciding PASS, FAIL, BLOCKED or NOT RUN for any local music-video project.
---

# Music Video Quality Gate

Independent verification for the factory and its local projects. It observes actual commands and outputs; it does not infer success from intentions, source claims, or prior conversation.

## Activation conditions

- Any P0/P1 acceptance, release, render or migration report is requested.
- Timing, renderer, workspace isolation, asset provenance or skills changed.
- A project transitions from planning to render.
- Do not use to implement fixes during a gate run; gate first, then repair.

## Input contract

- Repository path and actual VCS state.
- `factory/` source, tests, build output and scripts.
- `MV_WORKSPACE_ROOT` and the specific project config/assets.
- Actual test, typecheck, build, composition and render outputs.
- ffprobe output for delivered media.
- Skill inventory and `AGENTS.md`.
- Written authorization for any provider, paid call, publish or commit.

## Required workflow

1. Record the true starting state. Do not assume a branch, SHA, remote or CI.
2. Audit configuration and workspace isolation, including traversal, repository-inside roots, junctions/symlinks and missing-env fallback.
3. Audit the central write boundary: render outputs, `--out`, staging, cache recreation, reports and seed writes.
4. Validate every chapter/shot using integer output frames and half-open ranges.
5. Verify selection happens before renderer sampling and that sampling cannot move a cut or audio.
6. Run the actual typecheck, tests and build configured by the repository.
7. Render a short local synthetic project; inspect dimensions, fps, frame count, codec, pixel format, color and audio.
8. Verify rejected output paths write no files and source media remains unchanged.
9. Check visual consistency and approved asset provenance, including references and hashes.
10. Audit Git tracked/staged/untracked production media without staging or committing anything.
11. Audit network and provider activity. Any external call must be named.
12. Inspect CI workflow permissions and commands; do not invent a remote run.
13. Report every gate as PASS, FAIL, BLOCKED or NOT RUN; stop after the requested phase.

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
- Two synthetic projects load without engine source changes.
- Pixel and nonpixel profiles, and different fps/dimensions/durations, validate.
- Frame ownership passes for first, final and boundary frames.
- Sampling isolation and workspace safety tests pass.
- Unsafe output overrides, staging links and cleanup escapes fail without writing.
- Source audio and approved assets remain hash-identical after staging/cleanup tests.
- No song-specific data is newly staged, committed or transmitted.
- Legacy compositions remain registered with reasonable regression parity.
- Typecheck, tests, build and a short synthetic render pass, or blockers are explicit.
- CI workflow has read-only permissions, engine-only jobs and no artifact upload.
- No provider/paid/network project-data activity occurred.

## Failure behavior

- Missing evidence: NOT RUN, never PASS.
- Structural regression in timing, workspace isolation, write-boundary safety, composition or legacy compatibility: FAIL.
- External prerequisite prevents verification: BLOCKED, with the exact prerequisite.
- Any request to hide a failure, fabricate evidence or skip a gate: refuse.
- If publication was not authorized, mark remote CI evidence NOT RUN and leave changes local.
- Stop after the report; do not start the next phase without authorization.
