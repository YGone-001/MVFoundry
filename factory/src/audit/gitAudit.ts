import {spawnSync} from 'node:child_process';

export type GitAuditStatus = 'not_a_repository' | 'ok' | 'exposure_found';

export type GitAuditResult = {
  status: GitAuditStatus;
  branch: string | null;
  head: string | null;
  staged: string[];
  trackedMedia: string[];
  notes: string[];
};

const runGit = (cwd: string, args: string[]): {ok: boolean; stdout: string} => {
  const result = spawnSync('git', args, {cwd, encoding: 'utf8'});
  return {ok: result.status === 0, stdout: result.stdout ?? ''};
};

const MEDIA_PATTERN = /\.(wav|mp3|m4a|aac|flac|ogg|opus|mp4|mov|mkv|webm|avi)$/i;
const PRODUCTION_PATTERN = /(^|\/)(source\/audio|renders|cache\/render-public)\//i;

/**
 * Read-only audit. It never stages, commits, pushes or removes anything.
 */
export const auditGit = (cwd: string): GitAuditResult => {
  const inside = runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return {
      status: 'not_a_repository',
      branch: null,
      head: null,
      staged: [],
      trackedMedia: [],
      notes: ['Git is not initialized; no tracked or staged production data exists.'],
    };
  }

  const branch = runGit(cwd, ['branch', '--show-current']).stdout.trim() || null;
  const head = runGit(cwd, ['rev-parse', 'HEAD']).stdout.trim() || null;
  const staged = runGit(cwd, ['diff', '--cached', '--name-only', '-z']).stdout
    .split('\0')
    .filter(Boolean);
  const tracked = runGit(cwd, ['ls-files', '-z']).stdout.split('\0').filter(Boolean);
  const trackedMedia = tracked.filter(
    (file) => MEDIA_PATTERN.test(file) || PRODUCTION_PATTERN.test(file),
  );
  const stagedMedia = staged.filter(
    (file) => MEDIA_PATTERN.test(file) || PRODUCTION_PATTERN.test(file),
  );

  return {
    status: trackedMedia.length > 0 || stagedMedia.length > 0 ? 'exposure_found' : 'ok',
    branch,
    head,
    staged,
    trackedMedia: [...new Set([...trackedMedia, ...stagedMedia])],
    notes:
      trackedMedia.length > 0 || stagedMedia.length > 0
        ? ['Media or production paths are tracked or staged; do not commit or push.']
        : ['No audio/video media or production paths are tracked or staged.'],
  };
};
