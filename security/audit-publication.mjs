// Deterministic publication audit for MVFoundry.
// Lists the exact allowlisted files, hashes them and fails on secrets,
// absolute user paths, unexpected media, unexpected URLs or link escapes.
//
// Usage: node security/audit-publication.mjs [--write-list <path>]

import {createHash} from 'node:crypto';
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
const repoRoot = path.resolve(here, '..');
const allowlist = JSON.parse(
  readFileSync(path.join(here, 'publication-allowlist.json'), 'utf8'),
);

const skipDirs = new Set([
  '.git',
  'node_modules',
  'factory/dist',
  '.evidence',
  'out',
  'renders',
  'cache',
  '.test-build',
]);

const mediaExtensions = new Set(allowlist.mediaExtensions.map((ext) => ext.toLowerCase()));
const allowedUrlHosts = new Set(allowlist.allowedUrlHosts);
const findings = [];
const generatedIgnored = [];
const allowedFiles = new Set();

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

const isGeneratedIgnored = (relative) =>
  allowlist.generatedIgnoredGlobs.some((glob) => matchesGlob(relative, glob));

const addFile = (absolute) => {
  const relative = toPosix(path.relative(repoRoot, absolute));
  allowedFiles.add(relative);
  return relative;
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

// Every non-ignored file in the repository must be allowlisted or generated-ignored.
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
      discoverAll(absolute, relative);
    } else if (isGeneratedIgnored(relative)) {
      generatedIgnored.push(relative);
    } else if (!allowedFiles.has(relative)) {
      findings.push(`File is not on the publication allowlist: ${relative}`);
    }
  }
};
discoverAll(repoRoot, '');

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

const writeListIndex = process.argv.indexOf('--write-list');
if (writeListIndex >= 0 && process.argv[writeListIndex + 1]) {
  writeFileSync(
    path.resolve(process.argv[writeListIndex + 1]),
    [...allowedFiles].sort().join('\n') + '\n',
  );
}

const result = {
  pass: findings.length === 0,
  files: inventory.length,
  bytes: inventory.reduce((total, file) => total + file.bytes, 0),
  generatedIgnored: [...new Set(generatedIgnored)].sort(),
  findings,
  inventory,
};
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
