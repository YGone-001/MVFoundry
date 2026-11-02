import {existsSync} from 'node:fs';

/**
 * Offline browser readiness.
 *
 * Rendering needs a Chromium-compatible browser. Remotion can download one,
 * but an offline or policy-restricted host must never do that implicitly: the
 * first real pilot attempted the download and died on a network timeout *after*
 * the audio mix had already been built.
 *
 * This module only *detects* a usable browser. It never downloads anything and
 * never contacts a network endpoint. When no browser is available it reports a
 * structured refusal so the caller can stop before expensive work starts.
 */

export type BrowserReadinessStatus =
  | 'BROWSER_READY'
  | 'BROWSER_MISSING'
  | 'BROWSER_EXECUTABLE_INVALID'
  | 'BROWSER_VERSION_UNSUPPORTED'
  | 'BROWSER_PROVISIONING_NOT_AUTHORIZED';

export type BrowserReadiness = {
  status: BrowserReadinessStatus;
  /** Stable machine-readable code; equals status except for the refusal case. */
  code: string;
  executable: string | null;
  source: 'environment' | 'managed' | null;
  provisioning: 'not-required' | 'refused';
  detail: string;
  guidance: string[];
  tlsWarning: string | null;
};

type EnsureBrowserStatus =
  | {type: 'user-defined-path'; path: string}
  | {type: 'local-puppeteer-browser'; path: string}
  | {type: 'no-browser'}
  | {type: 'version-mismatch'; actualVersion: string | null};

export type EnsureBrowserLike = (options: {
  browserExecutable: string | null;
  onBrowserDownload: () => never;
}) => Promise<EnsureBrowserStatus>;

export const TLS_BYPASS_WARNING =
  'NODE_TLS_REJECT_UNAUTHORIZED=0 is set in this environment. MVFoundry never sets it and never ' +
  'disables certificate verification, but the variable is a host-wide safety hazard: unset it for ' +
  'any process that talks to a provider. Rendering is local and does not need it.';

/** Reports a host-wide TLS verification bypass without changing it. */
export const tlsEnvironmentWarning = (
  env: Record<string, string | undefined>,
): string | null => (env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ? TLS_BYPASS_WARNING : null);

/** Thrown from Remotion's download callback so provisioning can never start. */
export class BrowserProvisioningRefused extends Error {
  constructor() {
    super(
      'A browser download would be required, but MVFoundry never provisions one implicitly. ' +
        'Install a browser explicitly (npx remotion browser ensure) or set REMOTION_BROWSER_EXECUTABLE.',
    );
    this.name = 'BrowserProvisioningRefused';
  }
}

const GUIDANCE = [
  'Install a managed browser explicitly: npx remotion browser ensure',
  'Or point MVFoundry at an installed browser: REMOTION_BROWSER_EXECUTABLE=<path to chrome.exe>',
  'Rendering never downloads a browser on its own; the refusal above is the whole action.',
];

const executableFromEnv = (env: Record<string, string | undefined>): string | null => {
  for (const name of ['REMOTION_BROWSER_EXECUTABLE', 'CHROME_PATH'] as const) {
    const value = env[name];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
};

const invalid = (executable: string, detail: string, tlsWarning: string | null): BrowserReadiness => ({
  status: 'BROWSER_EXECUTABLE_INVALID',
  code: 'BROWSER_EXECUTABLE_INVALID',
  executable,
  source: 'environment',
  provisioning: 'not-required',
  detail,
  guidance: [
    'The configured browser path must be an existing regular file (for example chrome.exe).',
    'Unset REMOTION_BROWSER_EXECUTABLE / CHROME_PATH to use a managed browser instead.',
  ],
  tlsWarning,
});

/**
 * Resolves the render browser without any network access.
 *
 * `ensureBrowser` is injected so the decision can be tested offline. In
 * production it is Remotion's own `ensureBrowser`, called with a download
 * callback that always throws.
 */
export const checkRenderBrowser = async (input: {
  env: Record<string, string | undefined>;
  ensureBrowser: EnsureBrowserLike;
  existsFile?: (candidate: string) => boolean;
}): Promise<BrowserReadiness> => {
  const existsFile = input.existsFile ?? ((candidate: string) => existsSync(candidate));
  const tlsWarning = tlsEnvironmentWarning(input.env);
  const configured = executableFromEnv(input.env);
  if (configured !== null && !existsFile(configured)) {
    return invalid(configured, `Configured browser executable does not exist: ${configured}`, tlsWarning);
  }

  const refuse = (): never => {
    throw new BrowserProvisioningRefused();
  };

  let status: EnsureBrowserStatus;
  try {
    status = await input.ensureBrowser({browserExecutable: configured, onBrowserDownload: refuse});
  } catch (error) {
    if (error instanceof BrowserProvisioningRefused) {
      return {
        status: 'BROWSER_PROVISIONING_NOT_AUTHORIZED',
        code: 'BROWSER_PROVISIONING_NOT_AUTHORIZED',
        executable: null,
        source: null,
        provisioning: 'refused',
        detail:
          'No usable local browser was found. Remotion would need to download one, and this engine refuses to download implicitly.',
        guidance: GUIDANCE,
        tlsWarning,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (configured !== null && /browserExecutable/i.test(message)) {
      return invalid(configured, message, tlsWarning);
    }
    throw error;
  }

  if (status.type === 'no-browser') {
    return {
      status: 'BROWSER_MISSING',
      code: 'BROWSER_MISSING',
      executable: null,
      source: null,
      provisioning: 'refused',
      detail: 'No local browser was found and no download is authorized.',
      guidance: GUIDANCE,
      tlsWarning,
    };
  }
  if (status.type === 'version-mismatch') {
    return {
      status: 'BROWSER_VERSION_UNSUPPORTED',
      code: 'BROWSER_VERSION_UNSUPPORTED',
      executable: null,
      source: 'managed',
      provisioning: 'not-required',
      detail: `Installed browser version ${status.actualVersion ?? 'unknown'} does not match the version this Remotion release expects.`,
      guidance: GUIDANCE,
      tlsWarning,
    };
  }
  return {
    status: 'BROWSER_READY',
    code: 'BROWSER_READY',
    executable: status.path,
    source: status.type === 'user-defined-path' ? 'environment' : 'managed',
    provisioning: 'not-required',
    detail:
      status.type === 'user-defined-path'
        ? 'Using the explicitly configured browser executable.'
        : 'Using the browser already managed by Remotion.',
    guidance: [],
    tlsWarning,
  };
};