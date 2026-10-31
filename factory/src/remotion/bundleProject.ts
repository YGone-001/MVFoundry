import path from 'node:path';
import type {LoadedProject} from '../config/types';
import {SceneModuleError} from '../errors';
import {sha256File} from '../media/hash';
import type {StagedMedia} from '../media/stagePublic';
import type {WriteBoundary} from '../workspace/writeBoundary';
import {stageProjectBundle, type StagedProjectBundle} from '../project/stageSceneBundle';

export type PreparedProjectBundle = StagedProjectBundle & {
  serveUrl: string;
  publicDir: string;
  engineRoot: string;
};

export type BundleProjectOptions = {
  engineRoot: string;
  boundary: WriteBoundary;
  stagedMedia: StagedMedia;
  onProgress?: (progress: number) => void;
};

/**
 * Bundles the project-specific staged entry. The entry, verified module copies
 * and webpack output all live under <project>/cache/engine-bundle. Only the
 * engine source and node_modules locations are read from the repository.
 */
export const bundleProject = async (
  project: LoadedProject,
  options: BundleProjectOptions,
): Promise<PreparedProjectBundle> => {
  const staged = stageProjectBundle(project, {boundary: options.boundary});
  for (const module of staged.modules) {
    const stagedFile = path.join(staged.modulesDir, module.stagedFileName);
    if (sha256File(stagedFile) !== module.sha256) {
      throw new SceneModuleError(
        `Staged scene module changed before bundling: ${module.id}`,
      );
    }
  }
  const engineSource = path.join(options.engineRoot, 'factory', 'src');
  const engineNodeModules = path.join(options.engineRoot, 'node_modules');
  const {bundle} = await import('@remotion/bundler');

  const serveUrl = await bundle({
    entryPoint: staged.entryPoint,
    outDir: staged.bundleDir,
    publicDir: options.stagedMedia.publicDir,
    rootDir: options.engineRoot,
    enableCaching: false,
    onProgress: options.onProgress ?? (() => undefined),
    webpackOverride: (config) => {
      config.resolve = config.resolve ?? {};
      const alias = config.resolve.alias;
      config.resolve.alias = {
        ...(Array.isArray(alias)
          ? Object.fromEntries(
              alias.map((entry) => [entry.name, entry.alias]),
            )
          : ((alias ?? {}) as Record<string, string | false | string[]>)),
        '@mvfoundry': engineSource,
      };
      const modules = config.resolve.modules ?? ['node_modules'];
      if (!modules.includes(engineNodeModules)) {
        config.resolve.modules = [engineNodeModules, ...modules];
      }
      return config;
    },
  });

  return {
    ...staged,
    serveUrl,
    publicDir: options.stagedMedia.publicDir,
    engineRoot: options.engineRoot,
  };
};
