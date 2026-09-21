// Canned Operating Intelligence data for DEMO MODE — enough for the Brain map,
// the object drawer, the learnings page and attachment extraction to render
// without a Brain. Mirrors the public /api/v1/knowledge|learning|extract shapes.

import type {
  ExtractResponse,
  KnowledgeCounts,
  KnowledgeDetailResponse,
  KnowledgeListParams,
  KnowledgeListResponse,
  KnowledgeObjectDetail,
  KnowledgeRelationship,
  LearningListParams,
  LearningListResponse,
  LearningRecord,
} from "@/lib/brain-types";

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

const base = {
  tags: [] as string[],
  implementation_status: "not_tested",
  internal_validation: "unvalidated",
  status: "active",
  current: true,
  priority: "normal",
  last_verified_at: null,
  source_platform: null,
  source_expert: null,
  applies_to: [] as string[],
  goals: [] as string[],
  platforms: [] as string[],
  business_functions: [] as string[],
  effective_from: null,
  effective_until: null,
  source_type: null,
  source_url: null,
  source_date: null,
  source_claims: null,
  sources: null,
  evidence_level: null,
  bucket: null,
};

const OBJECTS: KnowledgeObjectDetail[] = [
  {
    ...base,
    id: "obj-1",
    ref: "MG-001",
    name: "Source of Energy",
    summary: "A manager's job is to be the source of energy, standards and decisions for the team — not the bottleneck it waits on.",
    intelligence_class: "playbook",
    domain: "management",
    object_type: "framework",
    subtype: "manager_dependency",
    tags: ["delegation", "accountability"],
    authority: "B1",
    founder_endorsement: "practiscale_standard",
    implementation_status: "implemented",
    internal_validation: "validated",
    priority: "core",
    updated_at: iso(3),
    last_verified_at: iso(3),
    source_expert: "Dan Martell",
    source_type: "book",
    evidence_level: "validated_experiment",
    applies_to: ["managers", "team leads"],
    goals: ["reduce manager dependency", "faster decisions"],
    compiled_markdown:
      "# Source of Energy\n\n## Principle\nThe manager sets the pace. When the team waits on the manager for every decision, the manager has become the bottleneck.\n\n## How we apply it\n1. Publish decision rights per role.\n2. Weekly: list every decision that waited on you.\n3. Delegate the ones a competent owner could make with a rule.\n\n## Evidence\nApplied in the delivery team in Q2 — decisions waiting on the manager fell from 14/week to 4/week (see RES-004).",
  },
  {
    ...base,
    id: "obj-2",
    ref: "MG-027",
    name: "Manager as Approver",
    summary: "An older view that every client-facing decision should route through the manager for approval.",
    intelligence_class: "playbook",
    domain: "management",
    object_type: "framework",
    subtype: "decision_rights",
    authority: "C1",
    founder_endorsement: "interested",
    status: "historical",
    current: false,
    priority: "low",
    updated_at: iso(200),
    effective_until: iso(120),
    source_type: "internal_doc",
    evidence_level: "founder_experience",
    compiled_markdown:
      "# Manager as Approver\n\nHistorical. Superseded by MG-001 after the Q2 delegation experiment showed approval queues slowed delivery without improving quality.",
  },
  {
    ...base,
    id: "obj-3",
    ref: "SAL-003",
    name: "Discovery Before Pitch",
    summary: "Tighten discovery questioning and mirror the customer's stated priority before pitching; correlates with a higher close rate.",
    intelligence_class: "playbook",
    domain: "sales",
    object_type: "framework",
    subtype: "discovery",
    tags: ["discovery", "closing"],
    authority: "B1",
    founder_endorsement: "approved",
    implementation_status: "testing",
    internal_validation: "validated",
    priority: "strong",
    updated_at: iso(9),
    source_expert: "Practiscale sales team",
    evidence_level: "internal_data",
    compiled_markdown:
      "# Discovery Before Pitch\n\n## Rule\nNo pitch until the prospect has named their priority in their own words.\n\n## Proof\nCall scores: reps who mirror the stated priority early close 23% more often.",
  },
  {
    ...base,
    id: "obj-4",
    ref: "CO-001",
    name: "Current Pricing & Packages",
    summary: "The three packages, their prices and what each includes — the only source of truth for quoting.",
    intelligence_class: "business_reality",
    domain: "company",
    object_type: "pricing",
    subtype: "standard",
    authority: "A1",
    founder_endorsement: "practiscale_standard",
    internal_validation: "validated",
    priority: "core",
    updated_at: iso(1),
    last_verified_at: iso(1),
    effective_from: iso(60),
    evidence_level: "verified_truth",
    compiled_markdown:
      "# Current Pricing & Packages\n\n| Package | Price | Includes |\n|---|---|---|\n| Starter | $2,500/mo | Weekly coaching, call scoring |\n| Growth | $5,000/mo | + content engine |\n| Scale | $9,000/mo | + fractional ops lead |",
  },
  {
    ...base,
    id: "obj-5",
    ref: "CUS-012",
    name: "NEMT buyers value reliability over price",
    summary: "Facility coordinators in NEMT treat on-time performance as the deciding factor; price is secondary.",
    intelligence_class: "business_reality",
    domain: "customer",
    object_type: "insight",
    subtype: null,
    authority: "A4",
    founder_endorsement: "approved",
    priority: "normal",
    updated_at: iso(14),
    evidence_level: "internal_data",
    source_type: "call_score",
    compiled_markdown: "# NEMT buyers value reliability over price\n\nFrom 31 scored discovery calls: reliability was raised first in 24.",
  },
  {
    ...base,
    id: "obj-6",
    ref: "PI-002",
    name: "LinkedIn: hook in the first 2 lines",
    summary: "LinkedIn truncates after ~2 lines; posts that state the payoff before the fold earn 2× the dwell.",
    intelligence_class: "platform_intelligence",
    domain: "platform",
    object_type: "mechanic",
    subtype: "hook",
    authority: "B3",
    founder_endorsement: "interested",
    priority: "normal",
    updated_at: iso(21),
    source_platform: "linkedin",
    source_expert: "Justin Welsh",
    evidence_level: "source_teaching",
    compiled_markdown: "# LinkedIn: hook in the first 2 lines\n\nPut the payoff before the fold.",
  },
  {
    ...base,
    id: "obj-7",
    ref: "PM-001",
    name: "Q2 delegation experiment — results",
    summary: "Decisions waiting on the delivery manager fell from 14/week to 4/week over 6 weeks.",
    intelligence_class: "performance_memory",
    domain: "management",
    object_type: "result",
    subtype: null,
    authority: "A2",
    founder_endorsement: "approved",
    internal_validation: "validated",
    priority: "strong",
    updated_at: iso(30),
    evidence_level: "validated_experiment",
    compiled_markdown: "# Q2 delegation experiment — results\n\n- Before: 14 decisions/week waiting on the manager\n- After: 4/week\n- Period: 6 weeks",
  },
  {
    ...base,
    id: "obj-8",
    ref: "LRN-004",
    name: "Approval queues slow delivery without improving quality",
    summary: "What we learned from the Q2 delegation experiment.",
    intelligence_class: "organizational_learning",
    domain: "management",
    object_type: "learning",
    subtype: null,
    authority: "A5",
    founder_endorsement: "approved",
    internal_validation: "validated",
    priority: "normal",
    updated_at: iso(28),
    evidence_level: "validated_experiment",
    compiled_markdown: "# Approval queues slow delivery without improving quality\n\nDelegate with a rule, review weekly.",
  },
];

const RELATIONSHIPS: Array<{ from: string; to: string; type: string; status: string }> = [
  { from: "MG-001", to: "MG-027", type: "supersedes", status: "confirmed" },
  { from: "MG-001", to: "PM-001", type: "produced_result", status: "confirmed" },
  { from: "LRN-004", to: "MG-001", type: "used_playbook", status: "confirmed" },
  { from: "SAL-003", to: "CUS-012", type: "uses_evidence", status: "suggested" },
  { from: "MG-001", to: "SAL-003", type: "complements", status: "suggested" },
];

const LEARNING: LearningRecord[] = [
  {
    id: "lr-1",
    ref: "DEC-003",
    record_type: "decision",
    title: "Publish decision rights per role in delivery",
    status: "completed",
    department: "Delivery",
    owner: "demo@practiscale.co",
    summary: "Stop routing client-facing decisions through the manager.",
    created_at: iso(70),
    updated_at: iso(40),
    metrics_before: { decisions_waiting_per_week: 14 },
    metrics_after: { decisions_waiting_per_week: 4 },
    missing_evidence: [],
    playbooks: [{ ref: "MG-001", name: "Source of Energy" }],
    object_ref: null,
  },
  {
    id: "lr-2",
    ref: "EXP-002",
    record_type: "experiment",
    title: "Mirror the stated priority in the first 5 minutes",
    status: "measuring",
    department: "Sales",
    owner: "demo@practiscale.co",
    summary: "Two reps run the discovery script for 4 weeks.",
    created_at: iso(12),
    updated_at: iso(2),
    metrics_before: { close_rate: 0.31 },
    metrics_after: null,
    missing_evidence: ["sample size", "close rate after"],
    playbooks: [{ ref: "SAL-003", name: "Discovery Before Pitch" }],
    object_ref: null,
  },
  {
    id: "lr-3",
    ref: "LRN-004",
    record_type: "learning",
    title: "Approval queues slow delivery without improving quality",
    status: "validated",
    department: "Delivery",
    owner: "demo@practiscale.co",
    summary: "Six weeks of data; no quality regressions.",
    created_at: iso(28),
    updated_at: iso(28),
    metrics_before: null,
    metrics_after: null,
    missing_evidence: [],
    playbooks: [{ ref: "MG-001", name: "Source of Energy" }],
    object_ref: "LRN-004",
  },
  {
    id: "lr-4",
    ref: "RES-004",
    record_type: "result",
    title: "Decisions waiting on the manager: 14 → 4 per week",
    status: "completed",
    department: "Delivery",
    owner: "demo@practiscale.co",
    summary: null,
    created_at: iso(30),
    updated_at: iso(30),
    metrics_before: { decisions_waiting_per_week: 14 },
    metrics_after: { decisions_waiting_per_week: 4 },
    missing_evidence: [],
    playbooks: [],
    object_ref: "PM-001",
  },
];

function tally(values: (string | null)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) if (v) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function counts(): KnowledgeCounts {
  return {
    total: OBJECTS.length,
    byClass: tally(OBJECTS.map((o) => o.intelligence_class)),
    byDomain: tally(OBJECTS.map((o) => o.domain)),
    byType: tally(OBJECTS.map((o) => o.object_type)),
    learningByType: tally(LEARNING.map((r) => r.record_type)),
    entitiesByKind: { person: 6, department: 3, client: 4, offer: 3 },
    relationships: {
      confirmed: RELATIONSHIPS.filter((r) => r.status === "confirmed").length,
      suggested: RELATIONSHIPS.filter((r) => r.status === "suggested").length,
    },
    metrics: 2,
  };
}

/** Strip the detail-only fields so the list shape matches the real endpoint. */
function summaryOf(o: KnowledgeObjectDetail) {
  const {
    compiled_markdown: _md,
    applies_to: _a,
    goals: _g,
    platforms: _p,
    business_functions: _bf,
    effective_from: _ef,
    effective_until: _eu,
    source_type: _st,
    source_url: _su,
    source_date: _sd,
    source_claims: _sc,
    sources: _s,
    evidence_level: _el,
    bucket: _b,
    ...rest
  } = o;
  return rest;
}

export function demoKnowledgeList(params: KnowledgeListParams): KnowledgeListResponse {
  const q = (params.q ?? "").trim().toLowerCase();
  let list = OBJECTS.filter((o) => params.includeArchive || o.status !== "archived");
  if (params.class) list = list.filter((o) => o.intelligence_class === params.class);
  if (params.domain) list = list.filter((o) => o.domain === params.domain);
  if (params.type) list = list.filter((o) => o.object_type === params.type);
  if (q) {
    list = list.filter((o) =>
      `${o.ref} ${o.name} ${o.summary ?? ""} ${o.tags.join(" ")}`.toLowerCase().includes(q)
    );
  }
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const page = list.slice(offset, offset + limit);
  return {
    counts: counts(),
    objects: page.map(summaryOf),
    page: { limit, offset, returned: page.length },
  };
}

export function demoKnowledgeDetail(ref: string): KnowledgeDetailResponse | null {
  const object = OBJECTS.find((o) => o.ref.toLowerCase() === ref.toLowerCase());
  if (!object) return null;
  const relationships: KnowledgeRelationship[] = [];
  for (const [i, r] of RELATIONSHIPS.entries()) {
    const other = r.from === object.ref ? r.to : r.to === object.ref ? r.from : null;
    if (!other) continue;
    const o = OBJECTS.find((x) => x.ref === other);
    relationships.push({
      id: `rel-${i}`,
      type: r.type,
      direction: r.from === object.ref ? "out" : "in",
      status: r.status,
      ref: other,
      name: o?.name ?? other,
      intelligence_class: o?.intelligence_class ?? null,
    });
  }
  const learning = LEARNING.filter(
    (l) => l.object_ref === object.ref || l.playbooks.some((p) => p.ref === object.ref)
  ).map((l) => ({
    id: l.id,
    ref: l.ref,
    record_type: l.record_type,
    title: l.title,
    status: l.status,
    department: l.department,
    created_at: l.created_at,
  }));
  return { object, relationships, learning, chunks: 3 + (object.compiled_markdown?.length ?? 0) % 5 };
}

export function demoLearningList(params: LearningListParams): LearningListResponse {
  let list = LEARNING;
  if (params.status) list = list.filter((r) => r.status === params.status);
  if (params.type) list = list.filter((r) => r.record_type === params.type);
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const page = list.slice(offset, offset + limit);
  return { records: page, page: { limit, offset, returned: page.length } };
}

/** A canned extraction for a binary upload (pdf / image / audio) in demo mode. */
export function demoExtract(name: string, kind: "pdf" | "image" | "audio"): ExtractResponse {
  const text =
    kind === "audio"
      ? `[Demo transcript of ${name}] Quick note after the client call: they care most about on-time performance, price came up once. Follow up with the reliability proof point and the Growth package.`
      : kind === "image"
        ? `[Demo text read from ${name}] Dashboard screenshot: Close rate 31% → 38%. Discovery score avg 61/100. Top objection: "we already have a vendor".`
        : `[Demo text extracted from ${name}] Proposal summary: Growth package at $5,000/mo, weekly coaching plus the content engine; 90-day onboarding plan attached.`;
  return { name, kind, text, chars: text.length, truncated: false, meta: { demo: true } };
}
