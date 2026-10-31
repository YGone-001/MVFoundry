import type {LoadedProject, ProjectConfig, Shot} from '../config/types';
import {validateProjectConfig} from '../config/validate';
import {PreproductionError} from '../errors';
import {DEFAULT_SCENE_REGISTRY} from '../scenes/registry';
import type {WriteBoundary} from '../workspace/writeBoundary';
import type {
  AssetRequirement,
  CompileReport,
  LyricsDocument,
  MissingAssetsReport,
  Storyboard,
} from './types';
import {PREPRODUCTION_PATHS, writeProjectJson} from './store';
import {validateStoryboard} from './storyboard';
import type {AnnotationDocument} from './types';

const assetKindForRequirement = (
  requirement: AssetRequirement,
  project: LoadedProject,
): string | null => {
  if (!requirement.fulfilledAssetId) return null;
  if (requirement.kind === 'scene-module') return 'scene-module';
  return project.assets.find((asset) => asset.id === requirement.fulfilledAssetId)?.kind ?? null;
};

export const buildCandidateProject = (input: {
  project: LoadedProject;
  storyboard: Storyboard;
}): ProjectConfig => {
  const {project, storyboard} = input;
  const requirementById = new Map(storyboard.assetRequirements.map((requirement) => [requirement.id, requirement]));
  const chapters = storyboard.chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    startFrame: chapter.startFrame,
    endFrame: chapter.endFrame,
    shots: chapter.shots.map((storyShot): Shot => {
      const params = {...storyShot.rendererParams};
      for (const requirementId of storyShot.assetRequirementIds) {
        const requirement = requirementById.get(requirementId);
        if (!requirement) throw new PreproductionError(`Unknown asset requirement ${requirementId}`);
        if (requirement.status !== 'approved' || !requirement.fulfilledAssetId) {
          throw new PreproductionError(`Asset requirement ${requirement.id} is not approved`);
        }
        if (requirement.kind === 'scene-module') {
          if (storyShot.renderer !== `project:${requirement.fulfilledAssetId}`) {
            throw new PreproductionError(
              `Scene-module requirement ${requirement.id} must be used by its declared module renderer`,
            );
          }
          continue;
        }
        const kind = assetKindForRequirement(requirement, project);
        if (requirement.kind === 'image' || (requirement.kind === 'existing-asset' && kind === 'image')) {
          if (storyShot.renderer !== 'layered-canvas') {
            throw new PreproductionError(
              `Image requirement ${requirement.id} is only supported by the layered-canvas renderer`,
            );
          }
          params.assetId = requirement.fulfilledAssetId;
        } else if (requirement.kind === 'existing-asset' && kind === 'layer') {
          throw new PreproductionError(
            `Layer requirement ${requirement.id} needs a typed Hybrid media shot, which this plan does not define`,
          );
        } else if (requirement.kind === 'video' || requirement.kind === 'layer') {
          throw new PreproductionError(
            `Requirement ${requirement.id} needs a typed Video/Hybrid media shot, which this plan does not define`,
          );
        }
      }
      return {
        id: storyShot.id,
        startFrame: storyShot.startFrame,
        endFrame: storyShot.endFrame,
        renderer: storyShot.renderer,
        params,
      };
    }),
  }));
  const firstRenderer = chapters[0]?.shots[0]?.renderer ?? project.config.visual.defaultRenderer;
  const candidate: ProjectConfig = {
    ...project.config,
    audio: {...project.config.audio},
    lyrics: {...project.config.lyrics},
    narrative: {...project.config.narrative},
    visual: {
      ...project.config.visual,
      pixel: project.config.visual.pixel ? {...project.config.visual.pixel} : undefined,
      defaultRenderer: firstRenderer,
    },
    output: {
      ...project.config.output,
      durationInFrames: project.durationInFrames,
    },
    cues: project.config.cues.map((cue) => ({...cue})),
    chapters,
    sceneModules: project.config.sceneModules.map((module) => ({...module})),
    audioTracks: project.config.audioTracks.map((track) => ({
      ...track,
      gainAutomation: track.gainAutomation.map((point) => ({...point})),
    })),
    assets: project.config.assets.map((asset) => ({...asset})),
    permissions: {...project.config.permissions},
    render: {...project.config.render},
  };
  if (input.storyboard.source.audioSha256 !== project.config.audio.sha256) {
    throw new PreproductionError('Storyboard audio hash does not match the master audio');
  }
  if (input.storyboard.source.fps !== project.config.output.fps) {
    throw new PreproductionError('Storyboard fps does not match the project');
  }
  if (input.storyboard.source.durationFrames !== project.durationInFrames) {
    throw new PreproductionError('Storyboard duration does not match the project');
  }
  const rendererKinds = new Set([
    ...DEFAULT_SCENE_REGISTRY.kinds(),
    ...project.sceneModules.map((module) => `project:${module.id}`),
  ]);
  validateProjectConfig(candidate, {rendererKinds});
  return candidate;
};

const requirementReport = (storyboard: Storyboard): AssetRequirement[] =>
  storyboard.assetRequirements.filter((requirement) =>
    storyboard.missingAssetRequirements.includes(requirement.id),
  );

export const compileApprovedStoryboard = (input: {
  project: LoadedProject;
  storyboard: Storyboard;
  annotations: AnnotationDocument;
  lyrics: LyricsDocument | null;
  boundary: WriteBoundary;
}): {report: CompileReport; candidate: ProjectConfig | null} => {
  const storyboard = validateStoryboard(
    input.storyboard,
    input.project,
    input.annotations,
    input.lyrics,
  );
  if (storyboard.status !== 'approved') {
    throw new PreproductionError('Storyboard must be explicitly approved before compilation');
  }
  if (!storyboard.renderReady || storyboard.missingAssetRequirements.length > 0) {
    const missing: MissingAssetsReport = {
      schemaVersion: 1,
      projectId: input.project.config.projectId,
      storyboardRevision: storyboard.revision,
      status: 'blocked',
      missingAssetRequirements: [...storyboard.missingAssetRequirements],
      requirements: requirementReport(storyboard),
      notes: [
        'No candidate project was written. Fulfil and approve all required local assets, update the storyboard, and recompile.',
        'Draft plans may remain useful as production specifications, but they are not render-ready.',
      ],
    };
    const report: CompileReport = {
      schemaVersion: 1,
      projectId: input.project.config.projectId,
      storyboardRevision: storyboard.revision,
      status: 'blocked',
      candidatePath: null,
      missingAssetRequirements: [...storyboard.missingAssetRequirements],
      validation: 'not-run',
      notes: missing.notes,
    };
    writeProjectJson(input.boundary, PREPRODUCTION_PATHS.missingAssets, missing);
    writeProjectJson(input.boundary, PREPRODUCTION_PATHS.compileReport, report);
    return {report, candidate: null};
  }
  const candidate = buildCandidateProject({project: input.project, storyboard});
  const candidateConfig: ProjectConfig = input.lyrics
    ? {
        ...candidate,
        lyrics: {language: input.lyrics.language, path: input.lyrics.sourcePath},
      }
    : candidate;
  validateProjectConfig(candidateConfig, {
    rendererKinds: new Set([
      ...DEFAULT_SCENE_REGISTRY.kinds(),
      ...input.project.sceneModules.map((module) => `project:${module.id}`),
    ]),
  });
  const candidatePath = writeProjectJson(
    input.boundary,
    PREPRODUCTION_PATHS.candidate,
    candidateConfig,
  );
  const report: CompileReport = {
    schemaVersion: 1,
    projectId: input.project.config.projectId,
    storyboardRevision: storyboard.revision,
    status: 'ready',
    candidatePath: PREPRODUCTION_PATHS.candidate,
    missingAssetRequirements: [],
    validation: 'passed',
    notes: [
      'Candidate configuration written separately; project.json was not overwritten.',
      `Candidate path: ${candidatePath}`,
    ],
  };
  writeProjectJson(input.boundary, PREPRODUCTION_PATHS.compileReport, report);
  return {report, candidate: candidateConfig};
};