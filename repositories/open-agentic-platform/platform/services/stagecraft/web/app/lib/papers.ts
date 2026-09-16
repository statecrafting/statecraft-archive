// Unifies the two paper corpora into one reader model:
//   - the comprehensive whitepaper (flagship, rich: explorers, tables, refs)
//   - the five focused ecosystem papers (governance chrome: audit + certificate)
// Both normalise to `ReaderPaper` so a single reader component renders either.

import type { ArchDiagram } from "../components/architecture-explorer";
import {
  paperMeta,
  sections as whitepaperSections,
  references as whitepaperReferences,
  complianceTable,
  comparisonTable,
} from "./whitepaper-content";
import {
  specSpineExplorer,
  factoryPipelineExplorer,
  identityFlowExplorer,
} from "./explorer-diagrams";
import { papers as ecosystemPapers } from "./ecosystem-papers";

export interface ReaderBlock {
  heading?: string;
  paragraphs: string[];
}

export interface ReaderSection {
  id: string;
  number: string;
  title: string;
  specBinding?: string;
  explorer?: ArchDiagram;
  blocks: ReaderBlock[];
}

export interface ReaderReference {
  id: number;
  label: string;
  title: string;
  url: string;
  accessed: string;
}

export interface ReaderAuditEntry {
  timestamp: string;
  action: string;
  actor: string;
  specRef: string;
  hash: string;
}

export interface ReaderCertificate {
  version: string;
  specSpineAttestation: string;
  sbomHash: string;
  signatureAlgorithm: string;
  signerIdentity: string;
  issuedAt: string;
  expiresAt: string;
}

export interface ReaderPaper {
  slug: string;
  title: string;
  subtitle: string;
  author: string;
  date: string;
  abstract: string;
  readingTime: number;
  featured?: boolean;
  governingSpec?: { id: string; title: string; version: string; sha256: string };
  contentHash?: string;
  lastVerifiedAt?: string;
  tags?: string[];
  stats?: { value: string; label: string }[];
  sections: ReaderSection[];
  references?: ReaderReference[];
  complianceTable?: typeof complianceTable;
  comparisonTable?: typeof comparisonTable;
  auditTrail?: ReaderAuditEntry[];
  certificate?: ReaderCertificate;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Format an ISO date ("2026-06-15T...") to "Jun 15, 2026" without locale/Date. */
function formatIsoDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, year, month, day] = m;
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`;
}

function countWords(paragraphs: string[]): number {
  return paragraphs.reduce(
    (n, p) => n + p.trim().split(/\s+/).filter(Boolean).length,
    0
  );
}

function readingTime(paragraphs: string[]): number {
  return Math.max(1, Math.round(countWords(paragraphs) / 220));
}

const EXPLORER_BY_SECTION: Record<string, ArchDiagram> = {
  "spec-spine": specSpineExplorer,
  "factory-pipeline": factoryPipelineExplorer,
  "identity-collaboration": identityFlowExplorer,
};

// --- Flagship: the comprehensive whitepaper ---------------------------------
const whitepaperParagraphs = whitepaperSections.flatMap((s) =>
  s.subsections.flatMap((sub) => sub.content)
);

const flagship: ReaderPaper = {
  slug: "oap-ecosystem",
  title: paperMeta.title,
  subtitle: paperMeta.subtitle,
  author: paperMeta.author,
  date: paperMeta.date,
  abstract: paperMeta.abstract,
  readingTime: readingTime(whitepaperParagraphs),
  featured: true,
  tags: ["architecture", "governance", "owasp-asi-2026", "overview"],
  stats: [
    { value: "228", label: "Specs in the corpus" },
    { value: "SHA-256", label: "Hash-verifiable governance" },
    { value: "2-Phase", label: "Deterministic pipeline" },
  ],
  sections: whitepaperSections.map((s) => ({
    id: s.id,
    number: s.number,
    title: s.title,
    explorer: EXPLORER_BY_SECTION[s.id],
    blocks: s.subsections.map((sub) => ({
      heading: sub.title,
      paragraphs: sub.content,
    })),
  })),
  references: whitepaperReferences,
  complianceTable,
  comparisonTable,
};

// --- Focused: the five ecosystem papers -------------------------------------
const focused: ReaderPaper[] = ecosystemPapers.map((p) => {
  const allParagraphs = p.sections.flatMap((s) => s.content.split("\n\n"));
  return {
    slug: p.slug,
    title: p.title,
    subtitle: p.subtitle,
    author: p.authors.join(", "),
    date: formatIsoDate(p.publishedAt),
    abstract: p.abstract,
    readingTime: readingTime(allParagraphs),
    governingSpec: {
      id: p.governingSpec.id,
      title: p.governingSpec.title,
      version: p.governingSpec.version,
      sha256: p.governingSpec.sha256,
    },
    contentHash: p.contentHash,
    lastVerifiedAt: formatIsoDate(p.lastVerifiedAt),
    tags: p.tags,
    sections: p.sections.map((s, i) => ({
      id: s.id,
      number: String(i + 1).padStart(2, "0"),
      title: s.heading,
      specBinding: s.specBinding,
      blocks: [{ paragraphs: s.content.split("\n\n") }],
    })),
    auditTrail: p.auditTrail,
    certificate: p.certificate,
  };
});

export const readerPapers: ReaderPaper[] = [flagship, ...focused];

export function getReaderPaper(slug: string): ReaderPaper | undefined {
  return readerPapers.find((p) => p.slug === slug);
}
