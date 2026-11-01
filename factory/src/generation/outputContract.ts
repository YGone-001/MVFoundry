import {PreproductionError} from '../errors';
import type {
  BoundProviderOutput,
  GenerationJob,
  GenerationOperation,
  GenerationOutputKind,
  ProviderOutput,
  ProviderStatusResult,
} from './types';
import {PROVIDER_OUTPUT_SCHEMA_VERSION} from './types';

/**
 * An operation has exactly one documented output kind. Anything else is a
 * contract violation, not a variant to accommodate.
 */
export const OUTPUT_KIND_BY_OPERATION: Record<GenerationOperation, GenerationOutputKind> = {
  'text-to-image': 'image',
  'image-to-video': 'video',
  'text-to-video': 'video',
};

export const expectedOutputKindForOperation = (operation: GenerationOperation): GenerationOutputKind =>
  OUTPUT_KIND_BY_OPERATION[operation];

/**
 * A transparent layer is an image with alpha, not a separate media type: a
 * text-to-image operation may legitimately produce one when the model declares
 * alpha support. A video operation may only ever produce video.
 */
export const compatibleOutputKinds = (operation: GenerationOperation): GenerationOutputKind[] =>
  operation === 'text-to-image' ? ['image', 'transparent-layer'] : ['video'];

export const isCompatibleOutputKind = (
  operation: GenerationOperation,
  kind: GenerationOutputKind,
): boolean => compatibleOutputKinds(operation).includes(kind);

/**
 * Multiple results cannot be disambiguated without a human decision, so the
 * engine's selection policy is "exactly one, matching the bound job". Returning
 * more than one is rejected rather than silently picking the first.
 */
export const PROVIDER_OUTPUT_SELECTION_POLICY = 'single' as const;

const fail = (message: string): never => {
  throw new PreproductionError(message);
};

/** The job's declared kind must be producible by its operation. */
export const assertJobOutputContract = (job: GenerationJob): GenerationOutputKind => {
  if (!isCompatibleOutputKind(job.operation, job.output.kind)) {
    fail(
      `Job ${job.jobId} declares output kind ${job.output.kind} but ${job.operation} can only produce ${compatibleOutputKinds(job.operation).join(' or ')}`,
    );
  }
  return job.output.kind;
};

const isHttpsLocation = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname.length > 0;
  } catch {
    return false;
  }
};

/**
 * Binds provider bytes to the exact job and task that requested them. A missing
 * task id, a mismatched task id, an unexpected kind or an ambiguous result set
 * all fail closed: a malformed task response can never look successful.
 */
export const bindProviderOutput = (input: {
  job: GenerationJob;
  output: ProviderOutput;
}): BoundProviderOutput => {
  const {job, output} = input;
  const expectedKind = assertJobOutputContract(job);
  const expectedTaskId = job.execution.providerTaskId;
  const providedTaskId = output.providerTaskId;
  if (!providedTaskId) {
    fail(`Provider returned no task id for job ${job.jobId}; the result cannot be bound to a task`);
  }
  if (expectedTaskId !== null && providedTaskId !== expectedTaskId) {
    fail(
      `Provider returned task ${providedTaskId} but job ${job.jobId} is bound to task ${expectedTaskId}`,
    );
  }
  if (output.declaredKind && output.declaredKind !== expectedKind) {
    fail(
      `Provider declared ${output.declaredKind} output for job ${job.jobId}, which expects ${expectedKind}`,
    );
  }
  if (output.files.length !== 1) {
    fail(
      `Provider returned ${output.files.length} output files for job ${job.jobId}; policy "${PROVIDER_OUTPUT_SELECTION_POLICY}" requires exactly one`,
    );
  }
  const file = output.files[0];
  if (file.kind !== expectedKind) {
    fail(
      `Provider returned a ${file.kind} output for job ${job.jobId}, which expects ${expectedKind}`,
    );
  }
  if (!file.location || file.location.trim() === '') {
    fail(`Provider output for job ${job.jobId} has an empty location`);
  }
  if (file.source === 'https' && !isHttpsLocation(file.location)) {
    fail(`Provider output for job ${job.jobId} is not an absolute HTTPS location`);
  }
  if (file.source === 'local' && file.location.trim() === '') {
    fail(`Provider output for job ${job.jobId} has an empty local location`);
  }
  return {
    schemaVersion: PROVIDER_OUTPUT_SCHEMA_VERSION,
    jobId: job.jobId,
    providerTaskId: providedTaskId,
    kind: expectedKind,
    selectionPolicy: PROVIDER_OUTPUT_SELECTION_POLICY,
    file,
    notes: output.notes,
  };
};

/**
 * Validates a recorded task-status document against the task that was actually
 * submitted. Used for simulated and recorded provider responses; never executed
 * against a live endpoint in this phase.
 */
export const validateTaskStatusDocument = (input: {
  taskId: string;
  status: ProviderStatusResult;
}): ProviderStatusResult => {
  const {taskId, status} = input;
  if (status.state === 'succeeded') {
    if (status.outputUrls.length === 0) {
      fail(`Task ${taskId} reported success but returned no output URL`);
    }
    if (status.outputUrls.some((url) => !isHttpsLocation(url))) {
      fail(`Task ${taskId} returned an output URL that is not absolute HTTPS`);
    }
    if (status.outputUrls.length > 1) {
      fail(
        `Task ${taskId} returned ${status.outputUrls.length} output URLs; policy "${PROVIDER_OUTPUT_SELECTION_POLICY}" rejects ambiguous result sets`,
      );
    }
  }
  if (status.state !== 'succeeded' && status.outputUrls.length > 0) {
    fail(`Task ${taskId} is ${status.state} but reported output URLs`);
  }
  return status;
};

/** Parses the documented `{id, status, output, failure}` task document. */
export const parseTaskDocument = (input: {
  expectedTaskId: string;
  body: unknown;
  statusMap: Record<string, ProviderStatusResult['state']>;
}): ProviderStatusResult => {
  if (typeof input.body !== 'object' || input.body === null) {
    fail('Provider task response is not a JSON object');
  }
  const document = input.body as Record<string, unknown>;
  if (typeof document.id === 'string' && document.id !== input.expectedTaskId) {
    fail(`Provider task response is for ${document.id}, not the requested task ${input.expectedTaskId}`);
  }
  const rawStatus = String(document.status ?? '').toUpperCase();
  const state = input.statusMap[rawStatus];
  if (!state) {
    fail(`Provider returned an unrecognized task status "${rawStatus || '<missing>'}"`);
  }
  const outputUrls = Array.isArray(document.output)
    ? document.output.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
  const failure =
    state === 'failed'
      ? String((document.failure as string | undefined) ?? 'provider reported failure')
      : null;
  return validateTaskStatusDocument({
    taskId: input.expectedTaskId,
    status: {
      state,
      progress: typeof document.progress === 'number' ? document.progress : null,
      failure,
      outputUrl: outputUrls[0] ?? null,
      outputUrls,
    },
  });
};
