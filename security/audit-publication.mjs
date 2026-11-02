// Deterministic publication audit for MVFoundry.
// Lists the exact allowlisted files, hashes them and fails on secrets,
// absolute user paths, unexpected media, unexpected URLs or link escapes.
//
// Two evidence modes:
//   filesystem (default) — walks the working tree; untracked local tool
//                          directories are skipped and reported, never hidden.
//   candidate            — enumerates the exact tracked publication candidate
//                          from `git ls-files`, which is the stronger evidence.
//
// Usage: node security/audit-publication.mjs [--write-list <path>] [--candidate]

import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const skipDirs = new Set([
  '.git',
  'node_modules',
  // Local engineering evidence: excluded from Git, never publishable.
  'reports',
  'factory/dist',
  '.evidence',
  'out',
  'renders',
  'cache',
  '.test-build',
]);

/**
 * Local tool directories that must never reach the publication candidate.
 * A directory listed here is skipped in filesystem mode *only* when it holds no
 * tracked file; anything tracked inside it is reported as a finding instead.
 */
const LOCAL_TOOL_DIRS = new Set(['.workbuddy-ai', '.opencode']);

const toPosix = (value) => value.split(path.sep).join('/');

const matchesGlob = (relative, glob) => {
  const pattern = glob
    .split('/')
    .map((part) => {
      if (part === '**') return '.*';
      return part
        .split('*')
        .map((chunk) => chunk.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*');
    })
    .join('/');
  return new RegExp(`^${pattern}$`).test(relative);
};

export const trackedFiles = (repoRoot) => {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return output.split('\0').filter(Boolean).map(toPosix);
  } catch {
    return null;
  }
};

export const runAudit = (options = {}) => {
  const repoRoot = options.repoRoot ?? path.resolve(here, '..');
  const allowlist = JSON.parse(
    readFileSync(options.allowlistPath ?? path.join(repoRoot, 'security', 'publication-allowlist.json'), 'utf8'),
  );
  const mode = options.mode ?? 'filesystem';
  const tracked = options.tracked === undefined ? trackedFiles(repoRoot) : options.tracked;
  const trackedSet = tracked === null ? null : new Set(tracked);
  const localToolDirs = new Set(options.localToolDirs ?? [...LOCAL_TOOL_DIRS]);

  const mediaExtensions = new Set(allowlist.mediaExtensions.map((ext) => ext.toLowerCase()));
  const allowedUrlHosts = new Set(allowlist.allowedUrlHosts);
  const findings = [];
  const generatedIgnored = [];
  const skippedLocalToolDirs = [];
  const allowedFiles = new Set();

  const isGeneratedIgnored = (relative) =>
    allowlist.generatedIgnoredGlobs.some((glob) => matchesGlob(relative, glob));

  const addFile = (absolute) => {
    const relative = toPosix(path.relative(repoRoot, absolute));
    allowedFiles.add(relative);
    return relative;
  };

  const handleLocalToolDir = (relative) => {
    const inside = tracked === null ? [] : tracked.filter((file) => file.startsWith(`${relative}/`));
    if (inside.length > 0) {
      for (const file of inside) {
        findings.push(`Tracked file inside a local tool directory: ${file}`);
      }
      return;
    }
    if (!skippedLocalToolDirs.includes(relative)) skippedLocalToolDirs.push(relative);
  };

  const walk = (absoluteDir, relativeDir) => {
    for (const entry of readdirSync(absoluteDir, {withFileTypes: true})) {
      const absolute = path.join(absoluteDir, entry.name);
      const relative = toPosix(path.join(relativeDir, entry.name));
      if (entry.isSymbolicLink()) {
        findings.push(`Symlink/junction is not allowed: ${relative}`);
        continue;
      }
      if (skipDirs.has(relative)) continue;
      if (entry.isDirectory()) {
        if (localToolDirs.has(relative)) {
          handleLocalToolDir(relative);
          continue;
        }
        walk(absolute, relative);
      } else if (isGeneratedIgnored(relative)) {
        generatedIgnored.push(relative);
      } else {
        addFile(absolute);
      }
    }
  };

  for (const file of allowlist.files) {
    const absolute = path.join(repoRoot, file);
    if (!existsSync(absolute)) {
      findings.push(`Allowlisted file is missing: ${file}`);
      continue;
    }
    if (!lstatSync(absolute).isFile()) findings.push(`Not a regular file: ${file}`);
    addFile(absolute);
  }

  for (const directory of allowlist.directories) {
    const absolute = path.join(repoRoot, directory);
    if (!existsSync(absolute)) {
      findings.push(`Allowlisted directory is missing: ${directory}`);
      continue;
    }
    if (!lstatSync(absolute).isDirectory()) {
      findings.push(`Not a directory: ${directory}`);
      continue;
    }
    walk(absolute, directory);
  }

  if (mode === 'candidate') {
    if (tracked === null) {
      findings.push('candidate mode requires a Git working tree; `git ls-files` failed');
    } else {
      for (const relative of tracked) {
        if (!allowedFiles.has(relative)) {
          findings.push(`Tracked file is not on the publication allowlist: ${relative}`);
        }
      }
    }
  } else {
    const discoverAll = (absoluteDir, relativeDir) => {
      for (const entry of readdirSync(absoluteDir, {withFileTypes: true})) {
        const absolute = path.join(absoluteDir, entry.name);
        const relative = toPosix(path.join(relativeDir, entry.name));
        if (entry.isSymbolicLink()) {
          findings.push(`Symlink/junction in tree: ${relative}`);
          continue;
        }
        if (skipDirs.has(relative)) continue;
        if (entry.isDirectory()) {
          if (localToolDirs.has(relative)) {
            handleLocalToolDir(relative);
            continue;
          }
          discoverAll(absolute, relative);
        } else if (isGeneratedIgnored(relative)) {
          generatedIgnored.push(relative);
        } else if (!allowedFiles.has(relative)) {
          findings.push(`File is not on the publication allowlist: ${relative}`);
        }
      }
    };
    discoverAll(repoRoot, '');
  }

  const userPathPatterns = [
    /[A-Za-z]:\\Users\\/i,
    /[A-Za-z]:\/Users\//i,
    /\/Users\/[A-Za-z0-9._-]+\//,
    /\/home\/[A-Za-z0-9._-]+\//,
  ];
  const secretPatterns = [
    /BEGIN (RSA |OPENSSH |EC |PGP )?PRIVATE KEY/,
    /ghp_[A-Za-z0-9]{20,}/,
    /github_pat_[A-Za-z0-9_]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /sk-[A-Za-z0-9]{20,}/,
    /xox[baprs]-[A-Za-z0-9-]{10,}/,
    /AIza[0-9A-Za-z_-]{35}/,
  ];

  const inventory = [];
  for (const relative of [...allowedFiles].sort()) {
    const absolute = path.join(repoRoot, relative);
    if (!existsSync(absolute)) {
      findings.push(`Allowlisted file is missing from the working tree: ${relative}`);
      continue;
    }
    const stat = lstatSync(absolute);
    if (stat.size > allowlist.maxFileBytes) {
      findings.push(`File exceeds size limit (${stat.size}): ${relative}`);
    }
    if (mediaExtensions.has(path.extname(relative).toLowerCase())) {
      findings.push(`Media file is not allowed in publication: ${relative}`);
    }
    const buffer = readFileSync(absolute);
    const hash = createHash('sha256').update(buffer).digest('hex');
    inventory.push({path: relative, bytes: buffer.length, sha256: hash});

    if (relative === 'security/audit-publication.mjs') continue;

    const text = buffer.toString('utf8');
    for (const pattern of userPathPatterns) {
      if (pattern.test(text)) findings.push(`Absolute user path in ${relative}: ${pattern}`);
    }
    for (const pattern of secretPatterns) {
      if (pattern.test(text)) findings.push(`Potential secret in ${relative}: ${pattern}`);
    }
    for (const match of text.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
      try {
        const host = new URL(match[0]).host;
        if (!allowedUrlHosts.has(host)) findings.push(`Unexpected URL host in ${relative}: ${host}`);
      } catch {
        findings.push(`Malformed URL in ${relative}: ${match[0]}`);
      }
    }
  }

  return {
    pass: findings.length === 0,
    mode,
    files: inventory.length,
    bytes: inventory.reduce((total, file) => total + file.bytes, 0),
    trackedFiles: tracked === null ? null : tracked.length,
    generatedIgnored: [...new Set(generatedIgnored)].sort(),
    skippedLocalToolDirs: [...new Set(skippedLocalToolDirs)].sort(),
    findings,
    inventory,
  };
};

const isEntryPoint = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isEntryPoint) {
  const args = process.argv.slice(2);
  const writeListIndex = args.indexOf('--write-list');
  const rootIndex = args.indexOf('--root');
  const rootArg = rootIndex >= 0 ? args[rootIndex + 1] : undefined;
  const result = runAudit({
    mode: args.includes('--candidate') ? 'candidate' : 'filesystem',
    ...(rootArg ? {repoRoot: path.resolve(rootArg)} : {}),
  });
  if (writeListIndex >= 0 && args[writeListIndex + 1]) {
    writeFileSync(
      path.resolve(args[writeListIndex + 1]),
      `${result.inventory.map((file) => file.path).sort().join('\n')}\n`,
    );
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
}
