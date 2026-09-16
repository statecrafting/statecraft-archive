// The reader model for the papers surface (spec 004 section 3.4). Only the
// re-authored flagship whitepaper ships; the OAP-era "focused" papers, whose
// substance was fabricated per-paper certificates and audit trails, are out of
// scope (spec 004 section 5). The reader renders whatever ReaderPaper it is
// given; this module normalises the whitepaper content into that shape.

import type { ArchDiagram } from "~/components/architecture-explorer";
import { PRODUCT_FAMILY } from "./product-family";
import {
  paperMeta,
  sections as whitepaperSections,
  references as whitepaperReferences,
  comparisonTable,
} from "./whitepaper";
import {
  specSpineExplorer,
  deliveryLoopExplorer,
  identityFlowExplorer,
} from "./explorer-diagrams";

export interface ReaderBlock {
  heading?: string;
  paragraphs: string[];
}

export interface ReaderSection {
  id: string;
  number: string;
  title: string;
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

export interface ReaderPaper {
  slug: string;
  title: string;
  subtitle: string;
  author: string;
  date: string;
  abstract: string;
  readingTime: number;
  featured?: boolean;
  tags?: string[];
  stats?: { value: string; label: string }[];
  sections: ReaderSection[];
  references?: ReaderReference[];
  comparisonTable?: typeof comparisonTable;
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

// Section id -> the diagram rendered inline at the end of that section.
const EXPLORER_BY_SECTION: Record<string, ArchDiagram> = {
  "spec-spine": specSpineExplorer,
  "governed-loop": deliveryLoopExplorer,
  identity: identityFlowExplorer,
};

const whitepaperParagraphs = whitepaperSections.flatMap((s) =>
  s.subsections.flatMap((sub) => sub.content)
);

const flagship: ReaderPaper = {
  slug: paperMeta.slug,
  title: paperMeta.title,
  subtitle: paperMeta.subtitle,
  author: paperMeta.author,
  date: paperMeta.date,
  abstract: paperMeta.abstract,
  readingTime: readingTime(whitepaperParagraphs),
  featured: true,
  tags: ["architecture", "governance", "spec-spine", "overview"],
  stats: [
    // Read off the spec-003 roster rather than typed, so the count cannot fall
    // behind the family the way a hardcoded "10" did when the eleventh repo
    // joined.
    {
      value: String(PRODUCT_FAMILY.length),
      label: "public repos, one governed family",
    },
    { value: "hash-linked", label: "attestation ledger; signing not yet in force" },
    { value: "1 container", label: "the enrahitu substrate, zero managed deps" },
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
  comparisonTable,
};

export const readerPapers: ReaderPaper[] = [flagship];

export function getReaderPaper(slug: string): ReaderPaper | undefined {
  return readerPapers.find((p) => p.slug === slug);
}
