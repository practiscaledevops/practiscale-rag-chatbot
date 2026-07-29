// Cost ESTIMATES for metered model calls.
//
// These rates are approximations used to populate the usage meter and admin
// analytics until the Brain reports authoritative billing. They are USD per
// 1,000,000 tokens, split into input (prompt) and output (completion). Update
// as provider pricing changes — nothing downstream hard-codes a dollar figure.
//
// Pure module: no secrets, no I/O — safe to import anywhere (server or client),
// though usage is metered server-side.

/** USD per 1M tokens for a model family. */
interface Rate {
  /** input / prompt tokens, USD per 1M */
  input: number;
  /** output / completion tokens, USD per 1M */
  output: number;
}

/**
 * Rate table, matched by id substring in PRIORITY ORDER (first match wins).
 * Order matters where names nest: "gpt-4o-mini" must be tested before "gpt-4o",
 * and "gpt-5" before the generic "gpt-4" family. Anthropic families are matched
 * by their tier word (opus/sonnet/haiku), which is present in every id form
 * (claude-opus-4-8, claude-3-5-sonnet-20241022, claude-3-haiku-20240307, …).
 */
const RATES: ReadonlyArray<{ readonly test: RegExp; readonly rate: Rate }> = [
  // --- Anthropic (Claude) ---------------------------------------------------
  { test: /opus/, rate: { input: 5, output: 25 } }, // claude-opus  $5 / $25
  { test: /sonnet/, rate: { input: 3, output: 15 } }, // claude-sonnet $3 / $15
  { test: /haiku/, rate: { input: 1, output: 5 } }, // claude-haiku $1 / $5

  // --- OpenAI (GPT) ---------------------------------------------------------
  // gpt-5 first (distinct family), then mini BEFORE the broader 4o match.
  { test: /gpt-5/, rate: { input: 5, output: 30 } }, // gpt-5     ~$5 / $30
  { test: /(4o-mini|gpt-4o-mini)/, rate: { input: 0.15, output: 0.6 } }, // gpt-4o-mini $0.15 / $0.6
  { test: /(gpt-4o|4o)/, rate: { input: 2.5, output: 10 } }, // gpt-4o    $2.5 / $10
];

// Fallback when the model id matches no known family. Mid-range so an unknown
// model is never costed as free. Deliberately conservative.
const DEFAULT_RATE: Rate = { input: 3, output: 15 };

/** Resolve the per-1M rate for a model id (case-insensitive, prefix/family). */
function rateFor(model: string): Rate {
  const id = (model ?? "").toLowerCase();
  for (const { test, rate } of RATES) {
    if (test.test(id)) return rate;
  }
  return DEFAULT_RATE;
}

/**
 * Estimated USD cost of a single model call. Matches the model by id
 * prefix/family (e.g. "claude-opus-4-8" → opus rates, "gpt-4o-mini" → mini
 * rates) and prices input and output tokens separately. Returns an estimate —
 * see the rate table above.
 *
 * @param model         resolved model id (the Brain's x-model header)
 * @param inputTokens   prompt tokens
 * @param outputTokens  completion tokens
 * @returns             estimated cost in USD (rounded to 6 dp, matching the
 *                      usage_events.cost_usd numeric(12,6) column)
 */
export function costUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const rate = rateFor(model);
  const input = Math.max(0, inputTokens || 0);
  const output = Math.max(0, outputTokens || 0);
  const cost = (input * rate.input + output * rate.output) / 1_000_000;
  // Round to 6 decimals to line up with numeric(12,6) storage.
  return Math.round(cost * 1e6) / 1e6;
}
