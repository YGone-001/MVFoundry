// Offline art-plate generator for the asset-backed 2.5D prototypes.
//
// Renders the repository's own procedural artwork through the local Remotion
// browser canvas into transparent or opaque PNG plates. Nothing is downloaded,
// no provider is called and no output leaves the configured external workspace.
//
// Usage:
//   node factory/scripts/generate-art-plates.mjs --workspace <root> --project <id> --set cinematic
// Requires factory/dist built and a local Chrome/Chromium for Remotion.

import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const workspaceRoot = arg('workspace', process.env.MV_WORKSPACE_ROOT);
const projectId = arg('project');
const set = arg('set', 'all');
if (!workspaceRoot || !projectId) {
  console.error('--workspace and --project are required');
  process.exit(2);
}
if (!['cinematic', 'anime', 'all'].includes(set)) {
  console.error('--set must be cinematic, anime or all');
  process.exit(2);
}

const {resolveProjectDir} = require('../dist/src/workspace/guard.js');
const {
  assertSafePath,
  createWriteBoundary,
  ensureSafeDirectory,
} = require('../dist/src/workspace/writeBoundary.js');
const {ART_PLATES} = require('../dist/src/art/plates.js');

const projectDir = resolveProjectDir({workspaceRoot, projectId, engineRoot: repoRoot});
const boundary = createWriteBoundary({projectDir, engineRoot: repoRoot});
const outDir = ensureSafeDirectory(boundary, path.join(projectDir, 'assets', 'plates'), 'project');

const selected = ART_PLATES.filter(
  (plate) => set === 'all' || plate.name.startsWith(`${set}-`),
);
if (selected.length === 0) {
  console.error(`No art plates selected for set ${set}`);
  process.exit(2);
}

// Browser readiness is decided before bundling so a missing browser is a setup
// problem, not a plate failure, and never triggers an implicit download.
const {checkRenderBrowser} = require('../dist/src/remotion/browserReadiness.js');
const {ensureBrowser, getCompositions, openBrowser, renderStill} = await import(
  '@remotion/renderer'
);
const readiness = await checkRenderBrowser({
  env: process.env,
  ensureBrowser: (options) =>
    ensureBrowser({browserExecutable: options.browserExecutable, onBrowserDownload: options.onBrowserDownload}),
  existsFile: (candidate) => existsSync(candidate),
});
if (readiness.status !== 'BROWSER_READY') {
  console.error(JSON.stringify({status: 'REFUSED', code: readiness.status, message: readiness.detail}, null, 2));
  process.exit(3);
}

const {bundle} = await import('@remotion/bundler');
const bundleDir = ensureSafeDirectory(boundary, path.join(boundary.cacheRoot, 'art-bundle'), 'cache');
const serveUrl = await bundle({
  entryPoint: path.join(repoRoot, 'factory', 'src', 'art', 'entry.tsx'),
  outDir: bundleDir,
  rootDir: repoRoot,
  enableCaching: false,
  onProgress: () => undefined,
});

const browserExecutable = readiness.executable;
const browser = await openBrowser('chrome', {browserExecutable, logLevel: 'warn'});
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const records = [];

try {
  for (const plate of selected) {
    const target = assertSafePath(boundary, path.join(outDir, `${plate.name}.png`), {
      expect: 'file',
      subtree: 'project',
    });
    const compositions = await getCompositions(serveUrl, {
      inputProps: {plate: plate.name, width: plate.width, height: plate.height},
      puppeteerInstance: browser,
      browserExecutable,
      logLevel: 'warn',
    });
    const composition = compositions.find((item) => item.id === 'ArtPlate');
    if (!composition) throw new Error('ArtPlate composition is missing');
    if (composition.width !== plate.width || composition.height !== plate.height) {
      throw new Error(
        `ArtPlate composition is ${composition.width}x${composition.height}, expected ${plate.width}x${plate.height}`,
      );
    }
    await renderStill({
      composition,
      serveUrl,
      output: target,
      frame: 0,
      imageFormat: 'png',
      overwrite: true,
      omitBackground: !plate.opaque,
      inputProps: {plate: plate.name, width: plate.width, height: plate.height},
      puppeteerInstance: browser,
      browserExecutable,
      logLevel: 'warn',
    });
    const bytes = statSync(target).size;
    records.push({
      name: plate.name,
      path: path.relative(projectDir, target).split(path.sep).join('/'),
      width: plate.width,
      height: plate.height,
      opaque: plate.opaque,
      bytes,
      sha256: sha256(target),
      note: plate.note,
    });
    console.log(`plate ${plate.name} ${plate.width}x${plate.height} ${bytes} bytes`);
  }
} finally {
  await browser.close({silent: true});
}

const manifestPath = path.join(outDir, 'plates.json');
mkdirSync(outDir, {recursive: true});
writeFileSync(
  manifestPath,
  `${JSON.stringify({schemaVersion: 1, projectId, generatedBy: 'factory/scripts/generate-art-plates.mjs', plates: records}, null, 2)}\n`,
);
console.log(
  JSON.stringify(
    {
      projectId,
      set,
      plates: records.length,
      manifest: path.relative(projectDir, manifestPath).split(path.sep).join('/'),
      records,
    },
    null,
    2,
  ),
);
