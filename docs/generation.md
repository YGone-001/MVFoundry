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
  pilot-admission.json    reviewed, single-use pilot admissions (see §19)
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
npm run generation -- pricing --project <id> [--snapshot <project-relative.json>]
npm run generation -- estimate --project <id> --job <JOB> [--snapshot <project-relative.json>]
npm run generation -- ledger --project <id>
npm run generation -- ledger-ceiling --project <id> --max-spend <usd|none> --notes "<review>"
npm run generation -- reserve --project <id> --job <JOB> [--snapshot <project-relative.json>]
npm run generation -- ledger-reconcile --project <id> --job <JOB> --status <reserved|submitted|reconciled-known|reconciled-unknown|released|canceled> [--actual-usd N] [--classification <unknown|estimated|user-entered|provider-reported>] [--task-id <ID>] --notes "<review>"
npm run generation -- ledger-unlock --project <id> --confirm --notes "<why>"
npm run generation -- preflight --project <id> --job <JOB> [--authorize-disclosure] [--snapshot <project-relative.json>]
npm run generation -- transport-check --project <id>
npm run generation -- retrieval-state --project <id> --job <JOB>
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

## 12. Live transport architecture

`factory/src/generation/transport.ts` is the only executable network path. It is
inert unless `liveExecutionEnabled` is explicitly true, and nothing in this phase
sets it.

### DNS-to-connection binding

1. The URL must be HTTPS, credential-free, on port 443, and its host must appear in
   the provider endpoint policy.
2. The hostname is resolved through an injected resolver. **Every** answer is
   screened; a mixed public/private answer is refused rather than narrowed.
3. One address is selected. The socket's `lookup` ignores the hostname it is handed
   and returns that address, so the TLS stack never performs a second, unvalidated
   resolution.
4. `servername` stays the DNS name, so SNI and certificate verification still apply
   to the hostname, not the IP.
5. A rebind between requests is refused because each request re-runs the whole
   validation and binds only to the address it validated.

### TLS and header policy

- `rejectUnauthorized` is always true, minimum TLS 1.2, system trust store unless a
  test injects anchors.
- The authorization header is refused for any host outside `authorizationHosts`, so a
  delivery host can never receive the API credential.
- Redirects are not followed by the transport; the caller decides.
- A configured environment proxy is refused, because a proxy resolves the
  destination itself and the binding cannot be guaranteed.

### Deadlines

The connect deadline covers TCP plus the TLS handshake. Once the socket is secure the
response deadline takes over, so a server that accepts and stalls is reported as a
response timeout rather than a connect timeout.

## 13. Pricing and cost estimation

`factory/src/generation/pricing.ts` holds a versioned snapshot transcribed on
2026-11-01 from `docs.dev.runwayml.com/guides/pricing/`:

| Model | Unit | Documented rate | Engine mapping |
| --- | --- | --- | --- |
| `gen4_image` | per image | 5 credits (720p), 8 credits (1080p) | long edge ≤1280 → 5, wider → 8 |
| `gen4_turbo` | per second | 5 credits per second | provider clip duration |

1 credit = $0.01, charges round up to the next credit, sales tax may apply. Every
other model on the provider page is listed as unsupported so a request can never
inherit a guessed rate.

The snapshot carries a content hash and a retrieval date. A snapshot that fails its
hash, is older than 30 days, or omits the model is refused. The estimator refuses an
unknown model, an unsupported model, an operation mismatch, a non-positive billable
dimension and an uncovered tier.

A local estimate is an upper bound for the documented tariff. It is not a guarantee
of the invoice: tax, discounts, promotions and other clients on the same account are
outside the engine's visibility.

## 14. Spending reservations and accounting

`factory/src/generation/ledger.ts` stores `<project>/generation/ledger.json` with one
entry per reservation:

- identity: entry id, project, job, provider, model, operation, authorization revision;
- money: authorized ceiling, estimate, reserved amount, actual amount, classification,
  released amount;
- state: status, submission count, provider task id, timestamps and provenance.

Invariants enforced in code:

- a submission requires an open reservation;
- a job cannot hold two open reservations;
- a reservation above the job ceiling or above the remaining project budget is refused;
- an uncertain outcome (`reconciled-unknown`) keeps the reservation exposed;
- a known charge releases the reservation and records the actual, labelled
  `user-entered` or `provider-reported`, never presented as provider-verified;
- cancellation releases the reservation without inventing a refund;
- the submission counter cannot exceed the authorized count;
- a ledger entry cannot be rebound to a different provider task.

### Concurrency

Reservation is a check-and-write under an exclusive lock created with
`open(…, 'wx')`. A second process waits with bounded jittered backoff, re-reads the
ledger, and is refused if the budget is already consumed. A lock older than the stale
threshold is never deleted silently: it fails closed with `lock-stale` and needs
`ledger-unlock --confirm`, which records the intervention.

Project-level budget controls do not limit spend incurred by other clients on the same
provider account.

## 15. Rate limits and safe retries

`factory/src/generation/retry.ts` is the single decision point.

| Class | Examples | Retry |
| --- | --- | --- |
| Rate limit | HTTP 429 | yes, honouring `Retry-After` |
| Load shedding | HTTP 502/503/504 | yes |
| Transient transport | timeout, DNS failure | yes |
| Authentication | HTTP 401/403 | no |
| Validation | HTTP 400/404/405 | no |
| Policy | host, address, TLS, redirect, header | no |
| **Billable submission** | any | **never** |

Backoff is exponential, bounded and jittered by up to 50%, matching the provider's
documented guidance. Status polling and retrieval may retry; a submission may not,
because an uncertain POST may already have created a paid task.

## 16. Atomic output persistence and recovery

A download is streamed into `<project>/cache/retrieval/<jobId>/`, hashed while
streaming, then published by renaming a file whose size and SHA256 were verified.
There is no copy-into-destination fallback. If a cross-device rename is impossible,
the file is staged inside the destination directory, verified, and renamed from
there; a failure removes every partial artefact and publishes nothing.

An existing finalized output is reused only when its hash matches; a different file
at the same path is refused unless `overwriteFinalized` was explicitly authorized.

`<project>/generation/state/<jobId>.json` records the phase
(`downloading` → `validated` → `finalizing` → `finalized`, or `failed`), and
`generation retrieval-state` classifies what a restart finds:

| Classification | Meaning |
| --- | --- |
| `no-media` | nothing downloaded |
| `incomplete-temp` | a partial temporary file exists |
| `downloaded-not-finalized` | the temporary file is complete but unpublished |
| `finalized-not-manifested` | published but no manifest yet |
| `finalized-awaiting-review` | published and pending review |
| `approved` | reviewed and approved |
| `ambiguous` | contradictory evidence; fails closed |

## 17. Operator preflight

`generation preflight` reports what would be sent, which model and assets would leave
the machine, whether disclosure is authorized, the estimated maximum charge, the
remaining budget, the submission limit, capability compliance, transport readiness,
credential presence (never the value), requirement currency and whether the job is
already submitted.

The report exposes six independent gates:

| Field | Values | Meaning |
| --- | --- | --- |
| `technicalReadiness` | `READY` / `BLOCKED` | every technical precondition, nothing about permission |
| `policyAdmission` | `DENIED_P0` / `PENDING` / `ADMITTED_FOR_PILOT` / `REFUSED` | project policy plus pilot admission |
| `budgetReservation` | `ACTIVE` / `MISSING` / `UNCERTAIN` | whether this job holds an open reservation |
| `referenceDisclosure` | `NOT_REQUIRED` / `AUTHORIZED` / `PENDING` / `DENIED` | whether references may leave the machine |
| `liveExecutionAuthorization` | `NOT_GRANTED` | the phase boundary; no code path produces `GRANTED` |
| `submissionState` | `NOT-SUBMITTED` / `ALREADY-SUBMITTED` / `UNCERTAIN` / `CONSUMED` | where the job stands |

`submissionAuthorized` is derived from all six and is therefore false in this phase,
even for a fully reviewed pilot. `liveExecution` remains the literal `NOT_GRANTED`,
and a passing technical result reads `READY FOR SEPARATELY AUTHORIZED PILOT`, never
`LIVE PROVIDER VERIFIED`. `policyGates` still reports the three project permission
flags and states that a pilot admission never changes them.

## 18. Go-live acceptance

`npm run golive:seed` creates `synthetic-golive-pricing-demo` (three shots: two video,
one image) and `synthetic-golive-render-demo` (one video shot with a reference asset
and a set of recorded fixtures).

`npm run golive:verify` runs 45 checks across five projects:

- **A** pricing, estimate refusals, reservation ceilings, preflight with and without a
  credential, transport policy, uncertain and canceled reconciliation;
- **B** two operating-system processes racing for the last of the budget;
- **C** transport and retrieval negatives, atomic finalization, interrupted download,
  expired-URL recovery, cross-project destination;
- **D** disclosure authorization, preflight, retrieval, normalization, staging,
  approval, compilation and a real rendered MP4 with decoded frames and soundtrack;
- **E** live refusal, unsupported model, duplicate submission, missing authorization,
  cross-project stage, corrupt media, stale requirement fingerprint.

## 18b. Pilot admission acceptance

`npm run pilot:seed` creates four synthetic projects in a fresh external workspace:
`synthetic-pilot-ordinary-demo` (ordinary P0 project), `synthetic-pilot-scope-demo`
(one scoped pilot job and a second prepared job), `synthetic-pilot-concurrency-demo`
(two jobs) and `synthetic-pilot-render-demo` (recorded fixtures and a reference
image).

`npm run pilot:verify` runs 54 checks:

- **A** the ordinary project still rejects `externalGeneration`, `localOnly: false`
  and `allowNetwork: true`; `submit-live` is refused; the shipped constant is false;
- **B** the admission binds the exact scope, an unreviewed admission is `PENDING`, a
  reviewed one is `ADMITTED_FOR_PILOT`, preflight separates the six gates, `pilot-submit`
  refuses without consuming, stale pricing and an exhausted budget block it, a foreign
  admission document and a linked write destination are refused, and a failed provider
  task produces nothing;
- **C** `DENIED_P0` for a job with no admission, two operating-system processes
  racing one admission (exactly one submission), expiry, revocation, an unauthorized
  reference and an uncertain submission that is never retried;
- **D** the full fake-provider lifecycle: submission, durable task id, polling,
  retrieval of real bytes, normalization, pending intake, review, compilation and a
  real 48-frame MP4 with decoded frames and a soundtrack;
- **F** the real adapter and the real secure transport against a controlled local
  HTTPS server, plus the same transport refusing every request while the gate is
  closed;
- **E** wrong project, wrong job, unsupported model, missing credential, changed
  reference hash, conflicting task id, consumed admission review, new storyboard
  revision and changed requirement fingerprint.

## 19. Pilot policy admission and one-shot execution

The P0 project policy is unchanged: `permissions.externalGeneration` must be `false`,
`localOnly` must be `true`, `allowNetwork` must be `false`, and `validateProjectConfig`
rejects anything else. A pilot admission is **not** a project mode and cannot be
expressed in `project.json`.

`generation/pilot-admission.json` holds reviewed, single-use admissions. Two designs
were possible: teach the project validator about pilot values, or keep the validator
untouched and evaluate an overlay at the submission boundary. The overlay was chosen
because it leaves the P0 negative tests byte-identical and makes "may this project do
external work?" independent of any runtime input. A data file alone is never
sufficient: the record is parsed with a closed key allowlist and every gate is
re-evaluated at the boundary.

### 19.1 Record

An admission binds one pilot id to one project, job, requirement id and fingerprint,
storyboard revision, provider, model, operation, output profile, pricing snapshot
identity, maximum estimated cost, authorized spend ceiling, exactly one submission,
and an exact reference set with a per-reference `uploadAuthorized` decision. It also
carries an admission revision, `approvalState` (`proposed` / `approved` / `denied` /
`revoked`), `expiresAt`, the `consumption` block (`unconsumed` / `consumed` /
`uncertain`, submission key, task id) and operator notes.

The record must not contain credentials, bearer tokens, signed URLs, raw payloads,
private absolute paths, audio or lyrics. `parsePilotAdmissionDocument` rejects those
keys and path-like or signed values structurally, so a later field cannot introduce
them, and a malformed document fails closed instead of being read as "no admission".

A pilot id is single-use for its whole lifetime: a new attempt needs a new id, so an
expired or revoked admission can never be silently renewed.

### 19.2 Staleness

The admission is refused with a stable code when the project, job, requirement id or
fingerprint, storyboard revision or approval, provider, model, operation, output
profile, reference set or hash, pricing snapshot, spend ceiling, expiry, approval
state or consumption state no longer matches. Nothing recomputes or extends an
admission automatically.

### 19.3 Gate evaluation

`evaluatePilotAdmission` is pure and reports `DENIED_P0` (no admission names the job),
`PENDING` (proposed/incomplete), `ADMITTED_FOR_PILOT` (every gate passes) or `REFUSED`
(a binding, budget, expiry, revocation or consumption check failed), together with a
per-gate `checks` table and human-readable blockers.

An admission is local operational evidence, **not** authenticated approval and not
cryptographic identity verification. Nothing in the engine proves who reviewed it.

### 19.4 One-shot ownership and submission

`runPilotSubmission` is the only service-level path from "admitted" to "submitted". It
evaluates every gate, then takes ownership inside the project ledger lock
(`consumePilotAdmission`), so two local processes can never both consume one
admission, and a job can never hold two reservations. The losing process refuses
before any provider call.

Order inside the service: resolve the explicitly named project/job/pilot → validate
the current storyboard and requirement → evaluate the admission → validate provider
capability → validate pricing → validate the per-job permission → read the ledger and
reservation → validate disclosure → validate credential presence (boolean only) →
validate the transport policy → refuse an already-submitted job → recheck expiry →
consume ownership → submit once → persist the task id immediately.

`LIVE_PROVIDER_EXECUTION_GRANTED` is `false`, so a live grant is refused at the
`live-authorization` stage **before** ownership is taken: the admission stays
`unconsumed` and nothing is charged. Only an injected `simulated` grant with a
simulated driver proceeds, which is how the acceptance suite and
`generation pilot-simulate` run the full lifecycle without a provider.

A failure after the request may have been transmitted parks the job as
`unknown-submission-state` and the admission as `uncertain`; both stay exposed, and no
retry is permitted until an operator reconciles the task. Only a failure decided
before a socket is opened returns an admission to `unconsumed`, and that closed set
lives in `submissionFailureTransmitted`.

`resumePilotSubmission` resumes status polling and retrieval from the persisted task
id, never submits, and preserves the provider bytes.

### 19.5 CLI

```text
npm run generation -- pilot-propose --project <id> --job <JOB> --pilot <ID> [--max-estimated-cost <usd>] [--spend-ceiling <usd>] [--expires-at <iso>] [--expires-in-hours <h>] [--upload <ASSET,...>] --notes "<review>"
npm run generation -- pilot-diff --project <id> --job <JOB> --pilot <ID>
npm run generation -- pilot-validate --project <id> --job <JOB> --pilot <ID> [--snapshot <project-relative.json>]
npm run generation -- pilot-review --project <id> --job <JOB> --pilot <ID> --decision <approve|deny> --notes "<review>"
npm run generation -- pilot-revoke --project <id> --job <JOB> --pilot <ID> --notes "<why>"
npm run generation -- pilot-inspect --project <id> --job <JOB> [--pilot <ID>]
npm run generation -- pilot-request --project <id> --job <JOB> [--pilot <ID>]
npm run generation -- pilot-submit --project <id> --job <JOB> [--pilot <ID>]        # always refused
npm run generation -- pilot-simulate --project <id> --job <JOB> --pilot <ID> --fixtures <project-relative.json>
```

Every mutating command names one project and one job; no command authorizes all
pending work. `pilot-review --decision approve` refuses while a binding mismatch or a
reference-disclosure blocker remains. `pilot-submit` reports the exact blockers and
exits non-zero without consuming the admission. `pilot-simulate` replays recorded
responses through an injected transport, polls the task, retrieves the bytes and
leaves them pending intake.

### 19.6 Transport wiring

`createProviderHttpTransport` bridges the provider adapter's `HttpTransport` to the
validated live transport and supplies the closed authorization-host list from the
endpoint policy, so an adapter can never widen where a credential may be sent. The
bridge performs no network work of its own and is inert while the live transport
refuses. The acceptance suite drives it against a controlled local HTTPS server with a
generated CA and proves the same transport refuses every request while the gate is
closed.

## 20. Limitations

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
- The live transport is exercised against a controlled local TLS server with a
  generated certificate authority. No real provider endpoint was contacted, so no
  claim is made about provider TLS configuration, latency, quota or cost.
- Proxy support is not implemented. A configured proxy is refused rather than
  silently bypassed.
- Pricing covers only the two models this engine implements. The published page lists
  many more; they are recorded as unsupported instead of being priced by inference.
- A local estimate is an upper bound for the documented tariff, not an invoice
  guarantee, and project budget controls do not constrain other clients on the same
  provider account.
- `transparent-layer` remains an image subtype; no provider in the manifest declares
  alpha.
- A pilot admission is local operational evidence. It does not authenticate the
  approver, does not bound spend at the provider, and does not survive a change to the
  project, job, requirement, storyboard, model, operation, output profile, reference
  hash, price or expiry.
- `LIVE_PROVIDER_EXECUTION` remains `NOT_GRANTED`. No live provider request, payment
  or private-reference upload was performed, so nothing in this document is evidence
  of live provider behaviour, billing or acceptance.
- The pilot concurrency guarantee is a single-host filesystem lock. It does not extend
  to two machines sharing a project over a network filesystem.
