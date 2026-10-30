---
name: remotion-mv-compositor
description: Maintain the reusable Remotion composition engine for MVFoundry. Use when adding renderers, resolving frame ownership, changing aspect ratios or frame rates, wiring local media, preserving soundtrack timing, or keeping legacy compositions working.
---

# Remotion MV Compositor

Owns the generic frame-to-pixels engine in `factory/`. Song-specific scenes and media stay in the external project workspace.

## Activation conditions

- A change touches the frame clock, timeline resolver, composition metadata, scene registry, renderer adapters or render script.
- A new renderer or project profile must be supported without editing the global clock.
- A render must be verified for dimensions, fps, frames, color or audio.
- Do not activate for story direction or provider contract work.

## Input contract

- A validated project config loaded through `factory/src/project/loadProject.ts`.
- `MV_WORKSPACE_ROOT` containing the project, audio and approved assets.
- A registered renderer kind from `factory/src/scenes/registry.ts`.
- Frame-domain chapters and shots using half-open ranges.
- Target output profile and render settings.
- For legacy work, the untouched `src/index.ts`, `src/debug/index.ts`, scenes and production data.

## Required workflow

1. Resolve the shot from the raw output frame first. Never quantize time before selection.
2. Compute local frame and renderer sampling after selection. Pixel sampling is allowed only inside the selected pixel renderer.
3. For 24fps output and 12fps sampling use `floor(localFrame / 2)`; for other integer ratios use `floor(localFrame * samplingFps / outputFps)`.
4. Keep output fps, dimensions and duration in project config. Do not hardcode 4919, 204.96 s, 480x270, 12fps or ten scenes globally.
5. Render through the typed registry. Add new renderers by registration, not by changing the frame clock.
6. Use the project-local staging directory as Remotion `publicDir`; never copy media into the engine repository.
7. Route all render output, staging, cache recreation and report writes through `factory/src/workspace/writeBoundary.ts`.
8. Keep default output under `<project>/renders`. Allow only a single filename relative to renders or an absolute direct child of renders for `--out`; reject traversal, other projects, engine paths and linked destinations before writing.
9. Restrict destructive cleanup to strict descendants of `<project>/cache`; never delete the cache root, project root, source audio or approved assets.
10. Preserve soundtrack timing. P0 stages and muxes the approved audio unchanged.
11. Render lossless frames and encode deterministically; verify actual output with ffprobe.
12. Keep the legacy compositions registered and do not rewrite S01-S10 during engine work.
13. Add or update frame-boundary, write-boundary and sampling-isolation tests before replacing routing logic.
14. Keep CI engine-only; do not upload media or production artifacts.

## Output contract

- Generic engine code and tests under `factory/`.
- A short synthetic render under the external project workspace.
- Frame-boundary and sampling evidence.
- ffprobe output for codec, dimensions, fps, frames, color and audio.
- A note distinguishing implemented renderers from typed placeholders.

## Prohibited actions

- Selecting a shot after pixel sampling.
- Global constants for one song's duration, scene count or style.
- Bundling arbitrary external TypeScript without a tested strategy.
- Copying project media into the engine repository.
- Public HTTP exposure of private media.
- WebGL, Three.js, GSAP or CSS timers as required runtime dependencies.
- Calling generation providers or paid services.
- Claiming a render or determinism without observed evidence.

## Acceptance checks

- Every output frame resolves exactly once; first, last and boundary frames are correct.
- Pixel sampling cannot delay a cut or alter soundtrack timing.
- Aspect ratios, fps and durations are profile-driven.
- A new renderer can be registered without changing the frame clock.
- Local assets resolve only from the approved manifest/staging.
- Every project write path passes the central boundary; no ad-hoc output or cleanup path exists.
- Unsafe `--out` values fail before any output file or staging write.
- Cache cleanup cannot reach sources, the project root or another project's cache.
- Short render has the expected codec, dimensions, frame count and audio timing.
- Legacy compositions and scene code remain available and unchanged.

## Failure behavior

- Missing workspace/project config: fail closed; do not fall back into the engine repo.
- Invalid frame or coverage: throw a domain/timeline error and stop.
- Missing or unapproved asset: refuse to render.
- Unsafe output or cleanup path: fail before writing; do not fall back to a default or a repository path.
- Unimplemented video/hybrid adapter: throw a typed placeholder error; do not fake output.
- Render tool failure: report NOT RUN with the exact command and error; never claim success.
