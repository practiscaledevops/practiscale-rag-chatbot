// Client-safe types, label maps and pure helpers for the Brain's Operating
// Intelligence surface: knowledge objects, learning records, extraction, and
// the two chat data events (conflicts / performance).
//
// NO secrets and NO fetch logic here — this file is imported by client
// components. The server-side calls (which hold BRAIN_API_KEY) live in
// lib/brain.ts. The ids below mirror the Brain's intelligence-taxonomy so the
// filters and chips line up with the real data.

// ---------------------------------------------------------------------------
// Taxonomy labels
// ---------------------------------------------------------------------------

export type IntelligenceClass =
  | "business_reality"
  | "playbook"
  | "organizational_learning"
  | "platform_intelligence"
  | "performance_memory"
  | "raw_archive";

export interface IntelligenceClassDef {
  id: IntelligenceClass;
  label: string;
  /** The question this class answers, shown on the Brain map cards. */
  question: string;
  description: string;
}

/** The five classes shown as cards on the Brain map (raw archive is provenance only). */
export const INTELLIGENCE_CLASSES: IntelligenceClassDef[] = [
  {
    id: "business_reality",
    label: "Business Reality",
    question: "What is true?",
    description: "Company truth, founder thinking, customers, calls, operations, brand, proof.",
  },
  {
    id: "playbook",
    label: "Playbooks",
    question: "What should work?",
    description: "Frameworks, principles and tactics from experts, books and our own discoveries.",
  },
  {
    id: "organizational_learning",
    label: "Organizational Learning",
    question: "What have we learned?",
    description: "What PractiScale decided, implemented, measured and learned.",
  },
  {
    id: "platform_intelligence",
    label: "Platform Intelligence",
    question: "How does each platform work?",
    description: "Per-platform formats, audience behaviour, hooks and constraints.",
  },
  {
    id: "performance_memory",
    label: "Performance Memory",
    question: "What results occurred?",
    description: "Structured results: content, sales, marketing and experiment outcomes.",
  },
];

export const CLASS_LABEL: Record<string, string> = {
  business_reality: "Business Reality",
  playbook: "Playbook",
  organizational_learning: "Org Learning",
  platform_intelligence: "Platform Intel",
  performance_memory: "Performance",
  raw_archive: "Raw Archive",
};

export const DOMAIN_LABEL: Record<string, string> = {
  founder: "Founder",
  company: "Company",
  customer: "Customer",
  sales: "Sales",
  marketing: "Marketing",
  content: "Content",
  offers: "Offers",
  customer_success: "Customer Success",
  management: "Management",
  leadership: "Leadership",
  talent_hiring: "Talent & Hiring",
  operations: "Operations",
  strategy: "Strategy",
  growth: "Growth",
  brand: "Brand",
  platform: "Platform",
  finance: "Finance",
  legal: "Legal",
  technology: "Technology",
  people_management: "People & Management",
  other: "Other",
};

/** Authority hierarchy — what the Brain believes when sources conflict. */
export const AUTHORITY_LABEL: Record<string, string> = {
  A1: "Current verified company truth",
  A2: "Verified business data",
  A3: "Founder current position",
  A4: "Customer / call evidence",
  A5: "Organizational learning",
  B1: "Approved PractiScale playbook",
  B2: "Approved external playbook",
  B3: "External source claim",
  C1: "Historical company information",
  C2: "Raw / unverified information",
  C3: "Archive",
};

export const ENDORSEMENT_LABEL: Record<string, string> = {
  interested: "Interested",
  approved: "Approved",
  practiscale_standard: "PractiScale Standard",
};

export const IMPLEMENTATION_LABEL: Record<string, string> = {
  not_tested: "Not tested",
  testing: "Testing",
  implemented: "Implemented",
};

export const VALIDATION_LABEL: Record<string, string> = {
  unvalidated: "Unvalidated",
  validated: "Validated",
  modified: "Modified",
  rejected: "Rejected",
};

export const EVIDENCE_LABEL: Record<string, string> = {
  source_teaching: "Source teaching",
  founder_experience: "Founder experience",
  internal_data: "Internal data",
  validated_experiment: "Validated experiment",
  verified_truth: "Verified truth",
};

export const PRIORITY_LABEL: Record<string, string> = {
  core: "Core",
  strong: "Strong",
  normal: "Normal",
  low: "Low",
};

export const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  draft: "Draft",
  historical: "Historical",
  archived: "Archived",
};

/** Human sentence fragment for a relationship type: "A {label} B". */
export const RELATIONSHIP_LABEL: Record<string, string> = {
  complements: "complements",
  related_to: "is related to",
  contradicts: "contradicts",
  supersedes: "supersedes",
  superseded_by: "is superseded by",
  enriched_by: "is enriched by",
  enriches: "enriches",
  derived_from: "is derived from",
  source_of: "is the source of",
  applied_in: "was applied in",
  taught_in: "was taught in",
  validated_by: "is validated by",
  implemented_in: "is implemented in",
  implements: "implements",
  used_playbook: "used the playbook",
  uses_evidence: "uses evidence",
  evidence_for: "is evidence for",
  produced_result: "produced the result",
  led_to: "led to",
  came_from: "came from",
  adapted_into: "was adapted into",
  adapted_from: "was adapted from",
  produced_content: "produced the content",
  based_on: "is based on",
};

/** Learning lifecycle stages, in order, plus the out-of-band postmortem. */
export const LEARNING_RECORD_TYPES = [
  "decision",
  "implementation",
  "experiment",
  "result",
  "learning",
  "adaptation",
  "standard",
  "postmortem",
] as const;

export const LEARNING_TYPE_LABEL: Record<string, string> = {
  decision: "Decision",
  implementation: "Implementation",
  experiment: "Experiment",
  result: "Result",
  learning: "Learning",
  adaptation: "Adaptation",
  standard: "Standard",
  postmortem: "Postmortem",
};

/** Chip colour per lifecycle stage (Tailwind classes must appear literally). */
export const LEARNING_TYPE_TONE: Record<string, string> = {
  decision: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  implementation: "border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  experiment: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  result: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  learning: "border-accent/30 bg-accent/10 text-accent",
  adaptation: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
  standard: "border-private/30 bg-private/10 text-private",
  postmortem: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

export const LEARNING_STATUSES = [
  "proposed",
  "open",
  "implementing",
  "measuring",
  "completed",
  "validated",
  "rejected",
  "archived",
] as const;

export const LEARNING_STATUS_LABEL: Record<string, string> = {
  proposed: "Proposed",
  open: "Open",
  implementing: "Implementing",
  measuring: "Measuring",
  completed: "Completed",
  validated: "Validated",
  rejected: "Rejected",
  archived: "Archived",
};

/** "customer_success" → "Customer success" for ids we have no label for. */
export function humanize(id: string | null | undefined): string {
  if (!id) return "";
  const s = id.replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "A1 · Current verified company truth", or "Unrated" when absent/unknown. */
export function authorityLabel(code: string | null | undefined): string {
  if (!code) return "Unrated";
  const label = AUTHORITY_LABEL[code];
  return label ? `${code} · ${label}` : code;
}

export function relationshipLabel(type: string): string {
  return RELATIONSHIP_LABEL[type] ?? humanize(type).toLowerCase();
}

export function classLabel(id: string | null | undefined): string {
  return (id && CLASS_LABEL[id]) || humanize(id) || "Unclassified";
}

export function domainLabel(id: string | null | undefined): string {
  return (id && DOMAIN_LABEL[id]) || humanize(id);
}

/** The composer prompt "Ask about this" seeds for a knowledge object. */
export function askPrompt(ref: string, name: string | null | undefined): string {
  const who = name ? `${ref} "${name}"` : ref;
  return `What does ${who} say, when does it apply, and how have we used it?`;
}

// ---------------------------------------------------------------------------
// GET /api/v1/knowledge
// ---------------------------------------------------------------------------

export interface KnowledgeListParams {
  class?: string;
  domain?: string;
  type?: string;
  q?: string;
  includeArchive?: boolean;
  limit?: number;
  offset?: number;
}

export interface KnowledgeCounts {
  total: number;
  byClass: Record<string, number>;
  byDomain: Record<string, number>;
  byType: Record<string, number>;
  learningByType: Record<string, number>;
  entitiesByKind: Record<string, number>;
  relationships: { confirmed: number; suggested: number };
  metrics: number;
}

export interface KnowledgeObjectSummary {
  id: string;
  ref: string;
  name: string;
  summary: string | null;
  intelligence_class: string;
  domain: string | null;
  object_type: string | null;
  subtype: string | null;
  tags: string[];
  authority: string | null;
  founder_endorsement: string | null;
  implementation_status: string | null;
  internal_validation: string | null;
  status: string | null;
  /** false = historical / expired (kept as context about the past). */
  current: boolean;
  priority: string | null;
  updated_at: string | null;
  last_verified_at: string | null;
  source_platform: string | null;
  source_expert: string | null;
}

export interface KnowledgePage {
  limit: number;
  offset: number;
  returned: number;
}

export interface KnowledgeListResponse {
  counts: KnowledgeCounts;
  objects: KnowledgeObjectSummary[];
  page: KnowledgePage;
}

// ---------------------------------------------------------------------------
// GET /api/v1/knowledge/{ref}
// ---------------------------------------------------------------------------

export interface KnowledgeObjectDetail extends KnowledgeObjectSummary {
  compiled_markdown: string | null;
  applies_to: string[];
  goals: string[];
  platforms: string[];
  business_functions: string[];
  effective_from: string | null;
  effective_until: string | null;
  source_type: string | null;
  source_url: string | null;
  source_date: string | null;
  /** Free-form; the Brain may send a string or a list of claims. */
  source_claims: string | string[] | null;
  /** Free-form provenance list (strings or {name,url}-ish objects). */
  sources: unknown;
  evidence_level: string | null;
  bucket: string | null;
}

export interface KnowledgeRelationship {
  id: string;
  type: string;
  direction: "out" | "in";
  status: string;
  ref: string;
  name: string;
  intelligence_class: string | null;
}

export interface KnowledgeLearningLink {
  id: string;
  ref: string;
  record_type: string;
  title: string;
  status: string;
  department: string | null;
  created_at: string;
}

export interface KnowledgeDetailResponse {
  object: KnowledgeObjectDetail;
  relationships: KnowledgeRelationship[];
  learning: KnowledgeLearningLink[];
  chunks: number;
}

// ---------------------------------------------------------------------------
// GET /api/v1/learning
// ---------------------------------------------------------------------------

export interface LearningListParams {
  status?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

export interface LearningRecord {
  id: string;
  ref: string;
  record_type: string;
  title: string;
  status: string;
  department: string | null;
  owner: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string | null;
  metrics_before: Record<string, unknown> | null;
  metrics_after: Record<string, unknown> | null;
  missing_evidence: string[];
  playbooks: Array<{ ref: string; name: string }>;
  object_ref: string | null;
}

export interface LearningListResponse {
  records: LearningRecord[];
  page: KnowledgePage;
}

// ---------------------------------------------------------------------------
// POST /api/v1/extract
// ---------------------------------------------------------------------------

export type ExtractKind = "url" | "youtube" | "pdf" | "audio" | "image" | "text";

export interface ExtractResponse {
  name: string;
  kind: ExtractKind;
  text: string;
  chars: number;
  truncated: boolean;
  meta: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Chat data events: `conflicts` and `performance`
// ---------------------------------------------------------------------------

export interface ConflictSide {
  ref: string;
  name: string | null;
  authority: string | null;
}

export interface ConflictPair {
  a: ConflictSide;
  b: ConflictSide;
  note: string | null;
}

export interface PerformanceMetric {
  key: string;
  label: string;
  value: number | string | null;
  unit: string | null;
  period_start: string | null;
  period_end: string | null;
  dimensions: Record<string, unknown> | null;
  source: string | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function conflictSide(v: unknown): ConflictSide | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const ref = str(o.ref);
  if (!ref) return null;
  return { ref, name: str(o.name), authority: str(o.authority) };
}

/**
 * Parse a `{ type: "conflicts", pairs: [...] }` data event. Returns null when
 * the event is not a conflicts event; malformed pairs are dropped.
 */
export function parseConflictsEvent(it: Record<string, unknown> | null | undefined): ConflictPair[] | null {
  if (!it || it.type !== "conflicts" || !Array.isArray(it.pairs)) return null;
  const out: ConflictPair[] = [];
  for (const p of it.pairs as unknown[]) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const a = conflictSide(o.a);
    const b = conflictSide(o.b);
    if (!a || !b) continue;
    out.push({ a, b, note: str(o.note) });
  }
  return out;
}

/**
 * Parse a `{ type: "performance", metrics: [...] }` data event. Returns null
 * when the event is not a performance event; metrics without a key are dropped.
 */
export function parsePerformanceEvent(it: Record<string, unknown> | null | undefined): PerformanceMetric[] | null {
  if (!it || it.type !== "performance" || !Array.isArray(it.metrics)) return null;
  const out: PerformanceMetric[] = [];
  for (const m of it.metrics as unknown[]) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const key = str(o.key);
    if (!key) continue;
    const value =
      typeof o.value === "number" && Number.isFinite(o.value)
        ? o.value
        : typeof o.value === "string"
          ? o.value
          : null;
    const dims =
      o.dimensions && typeof o.dimensions === "object" && !Array.isArray(o.dimensions)
        ? (o.dimensions as Record<string, unknown>)
        : null;
    out.push({
      key,
      label: str(o.label) ?? humanize(key),
      value,
      unit: str(o.unit),
      period_start: str(o.period_start),
      period_end: str(o.period_end),
      dimensions: dims,
      source: str(o.source),
    });
  }
  return out;
}

/** "MG-001 disagrees with MG-027 — the Brain favoured the higher-authority, current source". */
export function conflictSentence(pair: ConflictPair): string {
  return `${pair.a.ref} disagrees with ${pair.b.ref} — the Brain favoured the higher-authority, current source`;
}

/** "1,234", "12.5" or the raw string; "—" when absent. */
export function formatMetricValue(m: Pick<PerformanceMetric, "value" | "unit">): string {
  if (m.value === null) return "—";
  const v =
    typeof m.value === "number"
      ? m.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : m.value;
  return m.unit ? `${v} ${m.unit}` : v;
}

function shortDate(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  return t.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "1 Jan 2026 – 31 Mar 2026", one date, or "" when no period is known. */
export function formatPeriod(start: string | null, end: string | null): string {
  if (start && end) return `${shortDate(start)} – ${shortDate(end)}`;
  if (start) return `from ${shortDate(start)}`;
  if (end) return `to ${shortDate(end)}`;
  return "";
}
