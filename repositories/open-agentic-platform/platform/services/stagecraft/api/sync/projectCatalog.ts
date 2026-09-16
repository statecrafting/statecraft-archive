// Spec 112 §7 (amended by spec 119) — helpers for building
// `project.catalog.upsert` envelopes.
//
// Keeps the construction logic pure so it can be tested without the
// Encore runtime. Callers (sync relay + create/import endpoints) wire
// this into their outbound path on a per-org basis.

import { buildProjectOpenDeepLink } from "../projects/scaffold/deepLink";
import type { ServerProjectCatalogUpsert } from "./types";

export interface ProjectRowForCatalog {
  id: string;
  name: string;
  slug: string;
  description: string;
  factoryAdapterId: string | null;
  detectionLevel:
    | "not_factory"
    | "scaffold_only"
    | "legacy_produced"
    | "acp_produced"
    | null;
  updatedAt: Date | string;
}

export interface ProjectRepoForCatalog {
  githubOrg: string;
  repoName: string;
  defaultBranch: string;
}

export interface CatalogEnvelopeInputs {
  project: ProjectRowForCatalog;
  repo: ProjectRepoForCatalog | null;
  meta: ServerProjectCatalogUpsert["meta"];
  tombstone?: boolean;
}

export function buildProjectCatalogUpsert(
  input: CatalogEnvelopeInputs
): ServerProjectCatalogUpsert {
  const cloneUrl = input.repo
    ? `https://github.com/${input.repo.githubOrg}/${input.repo.repoName}.git`
    : "";
  const htmlUrl = input.repo
    ? `https://github.com/${input.repo.githubOrg}/${input.repo.repoName}`
    : "";
  const opcDeepLink = buildProjectOpenDeepLink({
    projectId: input.project.id,
    cloneUrl,
    detectionLevel:
      input.project.detectionLevel === "not_factory" ||
      input.project.detectionLevel === null
        ? undefined
        : input.project.detectionLevel,
  });
  const updatedAt =
    input.project.updatedAt instanceof Date
      ? input.project.updatedAt.toISOString()
      : String(input.project.updatedAt);
  return {
    kind: "project.catalog.upsert",
    meta: input.meta,
    projectId: input.project.id,
    name: input.project.name,
    slug: input.project.slug,
    description: input.project.description,
    factoryAdapterId: input.project.factoryAdapterId,
    detectionLevel: input.project.detectionLevel,
    repo: input.repo
      ? {
          githubOrg: input.repo.githubOrg,
          repoName: input.repo.repoName,
          defaultBranch: input.repo.defaultBranch,
          cloneUrl,
          htmlUrl,
        }
      : null,
    opcDeepLink,
    tombstone: input.tombstone === true,
    updatedAt,
  };
}
