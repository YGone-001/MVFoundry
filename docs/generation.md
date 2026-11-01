# AI Generation Jobs, Provider Adapters and Provider Media Lifecycle

This document covers the generation layer: the job contract from P1-E-C and the
provider-input/provider-output lifecycle completed in P1-E-D.

It converts approved production tasks into validated generation jobs, executes a
fully offline deterministic test provider, exposes one concrete Runway adapter
that has **never been executed live**, retrieves recorded provider output through
an injected transport, normalizes incompatible media deterministically, and hands
the bytes through the existing intake, approval, compilation and rendering
workflow.

It does not call paid providers, upload private references, transcribe audio or
generate real-song production assets.

`LIVE AI GENERATION: NOT RUN — NOT AUTHORIZED`
`REAL PROVIDER OUTPUT ACCEPTANCE: NOT RUN`

## 1. Files in an external project

```
<project>/generation/
  jobs.json               versioned generation jobs
  permissions.json        per-job cost/network/upload authorization records
  outputs/<jobId>/        retrieved provider bytes (never overwritten)
  outputs/<jobId>/normalized/  derived compatibility copies
  staging/<jobId>/        validated copy that intake points at
  manifests/<jobId>.json  result manifest (hash, probe, provenance)
  fixtures/               recorded provider responses and synthetic media
  reports/                retrieval, normalization, simulation and generation reports
```

All of it stays outside Git. Retrieval scratch space lives under
`<project>/cache/retrieval/<jobId>/` and is removed on success or failure.

## 2. Job contract

A job is traceable to exactly one approved requirement and records: job id, project,
requirement id, storyboard revision, requirement fingerprint, shot ids, provider,
operation, model, request revision, compiled prompt, output spec, continuity ids and
revisions, input references, permission state, execution state, provider task id,
attempts, attempt history, failure detail and kind, result files with hashes,
derived copies, and review state.

`schemaVersion: 1`; states are split deliberately:

- permission: `not-requested`, `awaiting-authorization`, `authorized`, `denied`;
- execution: `prepared`, `awaiting-authorization`, `queued`, `submitted`, `running`,
  `succeeded`, `failed`, `canceled`, `unknown-submission-state`, `output-retrieved`;
- review: `awaiting-review`, `approved`, `rejected`.

A succeeded provider task is never an approved asset.

## 3. Provider API contract (verified 2026-11-01)

Sources inspected on 2026-11-01:

| Source | What it establishes |
| --- | --- |
| `docs.dev.runwayml.com/api-details/versioning/` | `X-Runway-Version` is a date header; `/v1/` is not a version marker; old versions are supported for four months after a new version |
| `docs.dev.runwayml.com/assets/inputs/` | accepted reference formats, Data URI support, size and dimension envelopes |
| `docs.dev.runwayml.com/assets/outputs/` | `GET /v1/tasks/:id` response shape, delivery host, result-URL expiration |
| `docs.dev.runwayml.com/api/` | API reference index (client-rendered; no additional machine-readable detail retrieved) |

Recorded contract:

- Header: `X-Runway-Version: 2024-11-06`. The retrieved documentation describes the
  header format and the support window but does not publish a newer dated version on
  the pages inspected, so the pinned value is unchanged and no test was rewritten.
- Operations used by this engine: `POST /v1/text_to_image`,
  `POST /v1/image_to_video`, `GET /v1/tasks/{id}`.
- Task document: `{id, status, createdAt, output: [url...]}`; status values
  `PENDING`, `THROTTLED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`.
- Result URLs are ephemeral: documented as expiring within 24–48 hours of the API
  response. They must be downloaded and stored by the caller.
- Delivery host: a content-delivery domain that is **not** the API host
  (`dnznrvs05pmza.cloudfront.net` in the documented example), carrying signed query
  parameters.
- Reference images: JPEG, PNG or WebP; GIF unsupported. A Data URI is accepted for
  URL-accepting fields including `promptImage`, capped at 5 MB **encoded**
  (≈3.3 MB raw). URL inputs must be HTTPS, a DNS name, non-redirecting, at most
  2048 characters, and served with a valid `Content-Type` and `Content-Length`.
  Images below 640×640 or above 4K are discouraged; Gen-4 prompt images must fall in
  a 0.5–2.358 aspect window.
- Model manifests encoded here: `gen4_image` (text-to-image) and `gen4_turbo`
  (image-to-video, 5 s or 10 s clips).

Documented capability is not observed behaviour: no live request was made in this
phase, so no claim about live latency, quota or success rate is made.

## 4. Output typing

An operation produces exactly one media type:

| Operation | Documented output | Accepted job kinds |
| --- | --- | --- |
| `text-to-image` | image | `image`, `transparent-layer` (only when the model declares alpha) |
| `image-to-video` | video | `video` |
| `text-to-video` | video | `video` |

`transparent-layer` is an image subtype, not a separate media type, so it is only
accepted where the operation is documented to produce an image **and** the model
manifest declares alpha support. A job whose declared kind is incompatible with its
operation is rejected before submission.

`bindProviderOutput` binds the result to the exact job and task:

- a missing provider task id fails closed;
- a task id that differs from the persisted one fails closed;
- a file kind that differs from the job's declared kind fails closed;
- a non-HTTPS provider location fails closed;
- more than one output file fails closed, because the selection policy is
  `single` — an ambiguous result set is a human decision, not a default.

A task document that reports success without a URL, reports URLs while not
succeeded, carries an unknown status, or belongs to a different task id is rejected.

## 5. Reference image preparation

A local filesystem path is never a provider-accessible image. `prepareReferenceInput`
performs, in order:

1. resolve the project-local asset from `project.json`;
2. reject an unknown asset, a non-`approved` asset, or a non-image kind;
3. reject a hash that no longer matches the job's recorded reference hash;
4. resolve the path through the project guard (no absolute paths, no `..`);
5. reject symlinks, Windows junctions and any component whose real path differs;
6. verify the SHA256 against the exact bytes;
7. validate actual image content (PNG IHDR or JPEG SOF), never the extension;
8. enforce the documented size, dimension and aspect envelope;
9. confirm the provider/model accepts a reference at all;
10. record the exact asset identity as `asset:<id>#sha256:<12 hex>`.

The returned record contains no filesystem path and no payload. A payload only
exists inside `buildReferenceDataUri`, which requires an explicit disclosure state
that matches the requested purpose; `authorized-live` is refused in this phase.

Four decisions are kept distinct:

| Decision | Where it lives |
| --- | --- |
| local asset approval | `project.json` `assets[].approval` |
| intended reference use | `job.inputAssets` + continuity `referenceAssetId` |
| explicit external disclosure | `prepare-references --authorize-disclosure` |
| provider job execution | `generation/permissions.json` authorization |

`--uploads-private` on `approve-request` records upload intent for the job; it is not
upload consent for every referenced asset, and `resume` refuses to build a request
that carries references without `--authorize-disclosure`.

Providers that need an upload endpoint instead of an inline Data URI use the typed
`ReferenceUploadAdapter` boundary. The shipped adapter authorises nothing and
contacts nothing (`PRIVATE_REFERENCE_UPLOAD = NOT_GRANTED`).

## 6. Secure remote output retrieval

`retrieveRemoteOutput` is the only path from a provider URL to project bytes.

URL policy, applied to the first URL and to every redirect target:

- HTTPS only; any other scheme is refused;
- embedded credentials are refused;
- only the default 443 port;
- no IP literals — provider delivery hosts must be DNS names;
- at most 2048 characters;
- the host must match the provider's trusted output-host policy.

The policy is per provider and closed. Runway's documented delivery domain is
`dnznrvs05pmza.cloudfront.net`; the offline fixture provider has no hosts at all.
Expanding the list is a reviewed change because the negative tests assume it stays
closed. There is deliberately no rule that output must come from the API hostname.

Transport protections:

- every resolved address is screened before the request; loopback, private,
  carrier-grade NAT, link-local, multicast, reserved, documentation, 6to4, NAT64,
  unique-local and IPv4-mapped-private ranges are refused;
- redirects are followed manually, bounded to the policy limit, and revalidated;
- a redirect without `Location` or to an off-policy host is refused;
- the request has a deadline enforced by an abort signal and rechecked while
  streaming;
- the body is streamed to a `.part` file inside `<project>/cache/retrieval/<jobId>/`;
- the running byte count is enforced, so an undeclared oversized response is caught
  even without `Content-Length`;
- a declared `Content-Length` above the limit is refused before reading;
- a delivered byte count that differs from the declared count is `truncated`;
- the content type must be on the policy list and must agree with the job's kind;
- magic bytes must match the declared type, so an HTML page served as `video/mp4`
  is refused;
- the file is hashed while streaming and finalized atomically by rename inside the
  project; a failure removes the partial file.

Signed URLs are never persisted: the record keeps host, path and a query-parameter
count with `signedQueryRedacted: true`. Simulation transcripts record only
`origin + pathname`.

An expired result URL (`403`, `404`, `410`) is a **recoverable** retrieval failure.
Recovery re-queries the existing provider task for a fresh URL. It never resubmits
the generation and never fabricates a URL. A non-recoverable HTTP failure is
recorded as a retrieval failure, distinct from a generation failure.

## 7. Deterministic media normalization

Accepted Video/Hybrid renderers require MP4/H.264, constant frame rate, supported
dimensions, zero effective rotation and muted source audio. `inspectVideoDeep`
records container, codec, pixel format, dimensions, time base, nominal and average
frame rate, sampled frame timestamps, rotation, duration, decode validity and audio
stream count — from FFprobe plus a real decode pass, never from the extension.

`normalizeVideo` uses one reviewed profile (`video-normalize-v1`): MP4, libx264,
`yuv420p`, preset `veryfast`, CRF 20, GOP = fps/2, BT.709, source audio stripped,
`fit-pad` scaling. Only the numeric targets (fps, width, height, duration) vary;
project configuration cannot supply FFmpeg arguments, filtergraphs or shell
strings, and arguments are passed as a structured vector.

Rotation correction is delegated to FFmpeg's documented display-matrix application
(`-autorotate`), which also clears the matrix on the encoded output. A hand-written
`transpose` was rejected because FFmpeg 9 propagates the display matrix to the
output, so the renderer would still see rotation metadata. The recorded
`rotationCorrection` documents what was applied and the derived file is verified to
have zero rotation.

Fail-closed boundaries: corrupt or undecodable input, dimensions outside
16–3840 × 16–2160, duration above 120 s, an unusable or absent frame rate, fewer
than two frame timestamps, a rotation that is not a multiple of 90°, a non-even
target dimension, a target frame rate outside 0–120, and a derived duration shorter
than the shot requires.

The derived file must independently satisfy: MP4 container, `h264`, `yuv420p`,
exact target dimensions, target frame rate within 1e-3, zero rotation, clean decode
and no audio stream.

Provenance keeps both files: the original provider bytes are never overwritten, and
the normalization record stores the original path/hash/inspection, the derived
path/hash/inspection, the profile, the exact argument vector (with local paths
replaced by `<source>`/`<derived>`), the timing change and the frame
duplication/drop policy. A derived file is not approved automatically.

Transparency is never invented: an opaque image cannot satisfy a transparent-layer
requirement, and no Runway model in the manifest declares alpha.

## 8. Job identity, idempotency and durable recovery

`GEN-<hash>-<revision>` is derived from project, requirement, storyboard revision,
requirement fingerprint, provider, model, operation, output spec, continuity ids and
input hashes. Re-preparing the same request returns the existing job
(`duplicate: true`).

Recovery rules:

- the provider task id is persisted immediately after a successful submission
  response and before any status polling;
- a later `resume` on a bound job polls the existing task instead of submitting, and
  consumes no new submission budget;
- a returned task id that conflicts with the persisted one is a hard failure;
- attempt history is append-only: a later success never erases an earlier timeout;
- a submission timeout parks the job as `unknown-submission-state` with no task id
  and `failureKind: submission`; any retry is refused until the remote task is
  reconciled;
- retrieval refuses to run without a persisted task id, and refuses to run when the
  provider reported generation failure or cancellation;
- a retrieval failure is recorded with `failureKind: retrieval` and never triggers a
  new submission;
- partial downloads are cleaned up and a repeated retrieval is idempotent.

## 9. Output pipeline and approval

Staged output must live inside the project. The pipeline copies the bytes into
`generation/staging/<jobId>/`, computes SHA256, probes with `probeVideo` or
`probeLayerPng`, checks dimensions, codec, alpha and that the clip covers the shot,
writes a result manifest, and submits an **intake record with `review: "pending"`**
bound to the requirement fingerprint.

The job's declared output kind must equal the kind the requirement needs; a mismatch
fails before any record is written. Replacing an **approved** attachment requires
`stage --replace-approved --reason "<why>"`; without it the operation is refused.

Nothing is approved automatically. `generation review --decision approve` or
`preproduction review-asset` is the only path from pending to bound.

## 10. CLI

```text
npm run generation -- prepare --project <id> --requirement <REQ> [--provider offline-fixture|runway] [--model M] [--revision N] [--seed N]
npm run generation -- status --project <id> [--job <JOB>]            # exit 2 when a job is stale
npm run generation -- inspect --project <id> --job <JOB>
npm run generation -- inspect-output --project <id> --job <JOB>
npm run generation -- approve-request --project <id> --job <JOB> --authorization <authorized-for-simulation|denied> --max-spend <usd> [--max-submissions N] [--uploads-private] --notes "<review>"
npm run generation -- run-offline --project <id> --job <JOB> [--rights "<rights>"]
npm run generation -- submit-live --project <id> --job <JOB>         # always refused in this phase
npm run generation -- resume --project <id> --job <JOB> --fixtures <project-relative.json> [--authorize-disclosure]
npm run generation -- prepare-references --project <id> --job <JOB> [--authorize-disclosure]
npm run generation -- validate-response --project <id> --job <JOB> --response <project-relative.json>
npm run generation -- retrieve --project <id> --job <JOB> --fixture <project-relative.json> [--out <project-relative>] [--max-bytes N] [--rights "<rights>"]
npm run generation -- resume-retrieval --project <id> --job <JOB> --fixture <project-relative.json>
npm run generation -- inspect-media --project <id> --file <project-relative>
npm run generation -- normalize --project <id> --job <JOB> [--file <project-relative>] [--fps N] [--width W] [--height H] [--rights "<rights>"]
npm run generation -- compare-media --project <id> --original <project-relative> --derived <project-relative>
npm run generation -- stage --project <id> --job <JOB> [--file <project-relative>] --rights "<rights>" [--replace-approved --reason "<why>"]
npm run generation -- handoff --project <id> --job <JOB> [--file <project-relative>] --rights "<rights>"
npm run generation -- review --project <id> --job <JOB> --decision <approve|reject> --notes "<review>"
npm run generation -- blockers --project <id> --job <JOB>
npm run generation -- report --project <id>
```

Every command needs `--project` and `--workspace`/`MV_WORKSPACE_ROOT`, and every
command that acts on provider output needs an explicit `--job`. No command processes
every pending task or reaches another project. `--max-bytes` may only tighten the
provider policy limit, never raise it. Exit 0 means done, 1 means refused or failed,
2 means a guard reaction such as unsupported capabilities, a stale job or remaining
blockers. No command approves anything implicitly.

## 11. Acceptance

`npm run generation:seed` creates `synthetic-generation-image-demo`,
`synthetic-generation-video-demo` and `synthetic-generation-continuity-demo`.
`npm run generation:verify` runs the P1-E-C lifecycle.

`npm run provider:seed` creates fresh workspaces for the P1-E-D lifecycle:

- `synthetic-provider-image-demo` — text-to-image retrieval, pending intake,
  approval, layered-canvas render;
- `synthetic-provider-video-demo` — image-to-video retrieval of a deliberately
  incompatible clip (VFR + rotation + audio), normalization, Video render;
- `synthetic-provider-hybrid-demo` — two retrieved backgrounds plus transparent
  layers, shared continuity, Hybrid render;
- `synthetic-provider-guard-demo` — refusal, timeout and stale-requirement checks.

`npm run provider:verify` runs all four and writes evidence into each project's
`reports/`. Every byte comes from a recorded fixture through an injected transport.

## 12. Limitations

- Offline output is deterministic synthetic media, not AI generation, and no live
  provider behaviour has been observed.
- The Runway contract and capability matrix were encoded from documentation and
  exercised only through injected transports.
- Continuity is declarative; prompt wording cannot guarantee visual consistency.
- Reference preparation supports PNG and JPEG only; WebP is rejected even though the
  documented provider accepts it.
- Normalization does not attempt denoising, colour management beyond BT.709 tagging,
  audio preservation or re-timing beyond CFR conversion.
- A rotation that is not a multiple of 90° is rejected rather than approximated.
- The default DNS resolver refuses to run; a live retrieval must inject one.
