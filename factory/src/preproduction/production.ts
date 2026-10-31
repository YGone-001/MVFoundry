import type {LoadedProject} from '../config/types';
import {checkContinuityUsage} from './validate';
import type {
  AssetIntakeDocument,
  AssetRequirement,
  ContinuityDocument,
  ProductionTask,
  ProductionTaskManifest,
  ProductionTaskStatus,
  Storyboard,
  StoryboardShot,
} from './types';
import {PRODUCTION_TASK_SCHEMA_VERSION} from './types';

const recordFor = (intake: AssetIntakeDocument | null, requirementId: string) =>
  intake?.records.find((record) => record.requirementId === requirementId) ?? null;

/**
 * A task records what a human or a local tool must deliver. It is never proof
 * that an asset exists: only an approved, hash-verified intake record is.
 */
const statusFor = (
  requirement: AssetRequirement,
  intake: AssetIntakeDocument | null,
): {productionStatus: ProductionTaskStatus; reviewNotes: string | null} => {
  const record = recordFor(intake, requirement.id);
  if (record) {
    if (record.fingerprint !== requirement.fingerprint) {
      return {productionStatus: 'needed', reviewNotes: 'stale fulfillment record: re-attach required'};
    }
    if (record.review === 'pending') return {productionStatus: 'delivered', reviewNotes: null};
    if (record.review === 'in-review') return {productionStatus: 'under-review', reviewNotes: null};
    if (record.review === 'approved') return {productionStatus: 'approved', reviewNotes: record.reviewNotes};
    return {productionStatus: 'rejected', reviewNotes: record.reviewNotes};
  }
  if (requirement.status === 'in-production') return {productionStatus: 'in-production', reviewNotes: null};
  if (requirement.status === 'rejected') return {productionStatus: 'rejected', reviewNotes: null};
  if (requirement.status === 'available') return {productionStatus: 'delivered', reviewNotes: null};
  return {productionStatus: 'needed', reviewNotes: null};
};

const reviewStatusFor = (
  requirement: AssetRequirement,
  intake: AssetIntakeDocument | null,
): ProductionTask['reviewStatus'] => {
  const record = recordFor(intake, requirement.id);
  if (record) {
    if (record.review === 'approved') return 'approved';
    if (record.review === 'rejected') return 'rejected';
    if (record.review === 'in-review') return 'proposed';
    return 'draft';
  }
  if (requirement.status === 'approved') return 'approved';
  if (requirement.status === 'rejected') return 'rejected';
  return 'draft';
};

const acceptanceCriteriaFor = (
  requirement: AssetRequirement,
  project: LoadedProject,
  shot: StoryboardShot | undefined,
): string[] => {
  const {output} = project.config;
  const criteria = [
    `Local file supplied by the user or an approved project asset; no provider generation is authorized in this phase.`,
    `Aspect ratio ${requirement.aspectRatio} for a ${output.width}x${output.height} output at ${output.fps}fps.`,
    `Provenance and rights recorded at attachment; SHA256 verified again at compile time.`,
  ];
  if (requirement.kind === 'video') {
    criteria.push('MP4 container, H.264, constant frame rate, zero rotation metadata.');
    criteria.push(
      `Source must cover ${requirement.durationFrames ?? 0} output frames (${(
        (requirement.durationFrames ?? 0) / output.fps
      ).toFixed(6)}s) from the planned in-point.`,
    );
    criteria.push('Embedded audio is muted by the engine; the project mix is the only audio authority.');
  }
  if (requirement.kind === 'layer') {
    criteria.push('PNG with a real alpha channel; transparent pixels must survive encoding.');
    criteria.push(
      shot
        ? `Visible within shot ${shot.id} [${shot.startFrame},${shot.endFrame}) using shot-local frames.`
        : 'Layer visibility must stay inside the owning shot.',
    );
  }
  if (requirement.kind === 'image') {
    criteria.push('Decodable PNG or JPEG with no transparency requirement unless alphaRequired is set.');
  }
  if (requirement.kind === 'scene-module') {
    criteria.push('Project-local Canvas 2D module declared in project.json with a verified hash.');
  }
  if (requirement.alphaRequired) {
    criteria.push('Alpha channel is mandatory for this requirement.');
  }
  return criteria;
};

export const buildProductionTasks = (input: {
  project: LoadedProject;
  storyboard: Storyboard;
  continuity: ContinuityDocument | null;
  intake: AssetIntakeDocument | null;
}): ProductionTaskManifest => {
  const {project, storyboard} = input;
  const intake = input.intake ?? null;
  const continuity = input.continuity ?? null;
  const shots = storyboard.chapters.flatMap((chapter) => chapter.shots);
  const shotsById = new Map(shots.map((shot) => [shot.id, shot]));
  const continuityById = new Map((continuity?.entries ?? []).map((entry) => [entry.id, entry]));
  const findings = continuity ? checkContinuityUsage(continuity, shots) : [];
  const unapproved = new Set(
    (continuity?.entries ?? []).filter((entry) => entry.approval !== 'approved').map((entry) => entry.id),
  );

  const tasks: ProductionTask[] = storyboard.assetRequirements.map((requirement, index) => {
    const shot = shotsById.get(requirement.shotIds[0]);
    const record = recordFor(intake, requirement.id);
    const {productionStatus, reviewNotes} = statusFor(requirement, intake);
    const approvedReferenceIds = [
      ...new Set(
        requirement.continuityReferences
          .map((id) => continuityById.get(id)?.referenceAssetId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const stale = record !== null && record.fingerprint !== requirement.fingerprint;
    return {
      id: `TASK-${String(index + 1).padStart(3, '0')}`,
      requirementId: requirement.id,
      shotIds: [...requirement.shotIds],
      renderer: requirement.renderer,
      assetKind: requirement.kind,
      mediaSlot: requirement.mediaSlot,
      brief: requirement.description,
      visualStyle: requirement.visualStyle,
      targetWidth: requirement.kind === 'scene-module' ? null : project.config.output.width,
      targetHeight: requirement.kind === 'scene-module' ? null : project.config.output.height,
      aspectRatio: requirement.aspectRatio,
      targetDurationFrames: requirement.durationFrames,
      alphaRequired: requirement.alphaRequired,
      continuityIds: [...requirement.continuityReferences],
      approvedReferenceIds,
      provenanceRequirements: requirement.provenanceRequirements,
      acceptanceCriteria: acceptanceCriteriaFor(requirement, project, shot),
      productionStatus,
      reviewStatus: reviewStatusFor(requirement, intake),
      fulfilledAssetId: record && record.review === 'approved' && !stale ? record.assetId : null,
      path: record && record.review === 'approved' && !stale ? record.path : null,
      sha256: record && record.review === 'approved' && !stale ? record.sha256 : null,
      revision: storyboard.revision,
    };
  });

  const notes = [
    'A task describes work to be done locally; it never proves that an asset exists.',
    'Production status comes from an explicit attach plus reviewer decision, not from a filename.',
    ...(reviewNotesFor(tasks)),
    ...(findings
      .filter((finding) => finding.code === 'missing-reference-asset')
      .map((finding) => `Continuity reference asset missing: ${finding.message}`)),
  ];

  return {
    schemaVersion: PRODUCTION_TASK_SCHEMA_VERSION,
    projectId: project.config.projectId,
    storyboardRevision: storyboard.revision,
    tasks,
    unapprovedContinuityReferences: [...unapproved].sort(),
    notes,
  };
};

const reviewNotesFor = (tasks: readonly ProductionTask[]): string[] => {
  const stale = tasks.filter((task) => task.acceptanceCriteria.length > 0 && task.productionStatus === 'needed');
  return stale.length > 0
    ? [`${stale.length} task(s) still need a delivered local asset or a re-attachment.`]
    : ['Every task currently points at a delivered or approved local asset.'];
};
