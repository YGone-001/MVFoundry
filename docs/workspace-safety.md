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
  scenes/
  cache/
  renders/
  reports/
```

All song-specific content belongs here, never in the engine repository.

## Tests

The engine tests cover:

- missing `MV_WORKSPACE_ROOT`;
- workspace roots inside or containing the repository;
- project ID traversal;
- missing `project.json`;
- junction escapes to the repository and to an outside directory;
- manifest path traversal, absolute paths and link escapes.

These are unit tests over real temporary directories, not claims based on `.gitignore`.
