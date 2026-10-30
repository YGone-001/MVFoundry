# Factory Engine Quickstart

The reusable engine is in this directory. Song productions stay outside the repository under `MV_WORKSPACE_ROOT`.

## Build and test

```bash
npm run typecheck
npm run build
npm test
```

`npm test` regenerates the synthetic audio/image fixtures, compiles the engine and runs the tests. Synthetic binaries are ignored by Git.

## External workspace

```bash
export MV_WORKSPACE_ROOT=/absolute/path/outside/this/repository
npm run seed:examples
```

The seed command builds the engine, generates fixtures and creates the two synthetic projects plus their directory skeletons.

## Preview and render

```bash
npm run compositions
npx remotion studio factory/src/entry.tsx

npm run render:project -- --project synthetic-pixel-demo --mode video --frames 0-23
npm run render:project -- --project synthetic-layered-demo --mode still --frame 10
```

Set `REMOTION_BROWSER_EXECUTABLE` or `CHROME_PATH` when Remotion cannot locate a browser. Video encoding requires system FFmpeg on `PATH`.

## Safety

- `MV_WORKSPACE_ROOT` must be outside this repository and must not contain it.
- Never place production audio, images or renders in this repository.
- The renderer stages only approved, hash-verified assets into the external project cache.
- Do not commit or push without explicit authorization.
