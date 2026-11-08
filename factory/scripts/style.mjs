// Visual style inspection CLI.
//
// Usage:
//   node factory/scripts/style.mjs list
//   node factory/scripts/style.mjs inspect --id cinematic-illustration-2p5d
//   node factory/scripts/style.mjs check --project <projectId> [--workspace <root>]
//
// This reports declared capabilities. It never claims a blocked backend is
// implemented and it never approves a style for a production.
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

const catalog = require('../dist/src/style/catalog.js');
const themes = require('../dist/src/style/themes.js');

const mode = args[0] ?? 'list';

const list = () => {
  console.log(
    JSON.stringify(
      {
        styles: catalog.STYLE_IDS.map((id) => {
          const profile = catalog.getStyleProfile(id);
          return {
            id,
            label: profile.label,
            implementedBackends: profile.implementedBackends,
            compatibleBackends: profile.compatibleBackends,
            assetTypes: profile.assetTypes,
            limitations: profile.limitations,
          };
        }),
        themes: themes.THEME_IDS.map((id) => {
          const theme = themes.getThemeProfile(id);
          return {id, label: theme.label, mode: theme.mode};
        }),
        referenceOnlyThemes: themes.THEME_REFERENCE_ONLY,
        footageHybridRoute: catalog.FOOTAGE_HYBRID_ROUTE,
        backends: catalog.STYLE_BACKEND_CAPABILITIES,
      },
      null,
      2,
    ),
  );
};

const inspect = () => {
  const id = arg('id');
  if (!id) {
    console.error('--id is required');
    process.exit(2);
  }
  const profile = catalog.getStyleProfile(id);
  if (!profile) {
    console.error(`Unknown visual style '${id}'. Registered: ${catalog.STYLE_IDS.join(', ')}`);
    process.exit(2);
  }
  const themeId = arg('theme');
  const theme = themeId ? themes.getThemeProfile(themeId) : null;
  if (themeId && !theme) {
    console.error(`Unknown theme '${themeId}'. Registered: ${themes.THEME_IDS.join(', ')}`);
    process.exit(2);
  }
  console.log(JSON.stringify({style: profile, theme}, null, 2));
};

const check = () => {
  const projectId = arg('project');
  const workspaceRoot = arg('workspace', process.env.MV_WORKSPACE_ROOT);
  if (!projectId) {
    // Catalog-only health check.
    const failures = [];
    for (const id of catalog.STYLE_IDS) {
      const profile = catalog.getStyleProfile(id);
      if (!profile.implementedBackends.includes('canvas2d')) {
        failures.push(`${id} has no implemented backend`);
      }
      if (profile.palette.length < 3) failures.push(`${id} palette is too small`);
    }
    for (const entry of catalog.STYLE_BACKEND_CAPABILITIES) {
      if (entry.status === 'BLOCKED_CAPABILITY' && entry.detail.length < 20) {
        failures.push(`${entry.backend} has no concrete limitation`);
      }
    }
    console.log(JSON.stringify({catalog: true, pass: failures.length === 0, failures}, null, 2));
    if (failures.length > 0) process.exit(1);
    return;
  }
  if (!workspaceRoot) {
    console.error('--workspace or MV_WORKSPACE_ROOT is required with --project');
    process.exit(2);
  }
  const {loadProject} = require('../dist/src/project/loadProject.js');
  const project = loadProject(projectId, {workspaceRoot, engineRoot: repoRoot});
  const selection = project.config.visual.style ?? null;
  const style = selection ? catalog.getStyleProfile(selection.id) : null;
  const theme = selection?.theme ? themes.getThemeProfile(selection.theme) : null;
  const moduleStyles = project.sceneModules.map((module) => ({
    id: module.id,
    declaredStyleIds: module.styleIds ?? null,
  }));
  const findings = [];
  if (selection && !style) findings.push(`project selects unknown style ${selection.id}`);
  if (selection && style && !style.implementedBackends.includes('canvas2d')) {
    findings.push(`style ${selection.id} has no implemented backend`);
  }
  if (selection && selection.theme && !theme) {
    findings.push(`project selects unknown theme ${selection.theme}`);
  }
  for (const module of project.sceneModules) {
    if (selection && module.styleIds && !module.styleIds.includes(selection.id)) {
      findings.push(`module ${module.id} does not declare ${selection.id}`);
    }
  }
  console.log(
    JSON.stringify(
      {
        projectId,
        styleSelection: selection,
        style: style
          ? {
              id: style.id,
              label: style.label,
              implementedBackends: style.implementedBackends,
              theme: theme ? {id: theme.id, label: theme.label, mode: theme.mode} : null,
            }
          : null,
        legacyStyleProfile: selection ? null : project.config.visual.styleProfile,
        modules: moduleStyles,
        findings,
        pass: findings.length === 0,
      },
      null,
      2,
    ),
  );
  if (findings.length > 0) process.exit(1);
};

if (mode === 'list') list();
else if (mode === 'inspect') inspect();
else if (mode === 'check') check();
else {
  console.error('Usage: style.mjs list | inspect --id <style> | check [--project <id> --workspace <root>]');
  process.exit(2);
}
