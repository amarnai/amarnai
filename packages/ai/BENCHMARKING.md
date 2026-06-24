# Routing benchmark

Two harnesses tune and validate the embedding router (`src/embedding/sorter.ts`).
Both score the labeled email fixtures in `src/__tests__/fixtures/sorting-fixtures.ts`
across several taxonomy shapes (flat depth-1, deep depth-3, a domain-neutral
failure-mode taxonomy, and an origin-constrained taxonomy).

## Harnesses

| Script | What it tunes | LLM | Embeddings |
|---|---|---|---|
| `pnpm --filter @amarnai/ai benchmark:constants` | The six sorter threshold constants (4,096-combo grid) | stubbed (always escalates) | pre-computed fixture |
| `pnpm --filter @amarnai/ai benchmark:reasoning` | LLM reasoning-effort + prompt behaviour | live Gemini | live (prod-faithful) or fixture |

The grid stubs the LLM so its score reflects the embedding phase only. The
reasoning benchmark calls the live model, so it is the home for prompt-level
cases (e.g. origin-constrained nodes — Track P).

## Per-model fixtures

Cosine-similarity distributions differ by embedding model, so the grid is run
**per model**. Fixtures are one file per model: `embedding-vectors.<model>.json`.

Seed (env-driven, same factory as the runtime sorter):

```bash
# Default: qwen3 via Ollama (offline, keyless) — the CI smoke table
pnpm --filter @amarnai/ai seed:embeddings

# Gemini (production model). Provide credentials via env (.env.local / Railway):
EMBEDDING_PROVIDER=frontier \
FRONTIER_EMBEDDING_PROVIDER=gemini \
FRONTIER_EMBEDDING_MODEL=gemini-embedding-001 \
FRONTIER_EMBEDDING_DIMENSIONS=768 \
FRONTIER_EMBEDDING_API_KEY=… \
pnpm --filter @amarnai/ai seed:embeddings
```

Run the grid against a specific model's fixture:

```bash
pnpm --filter @amarnai/ai benchmark:constants                                   # qwen3 (default)
BENCHMARK_EMBEDDING_MODEL='gemini-embedding-001@768' pnpm --filter @amarnai/ai benchmark:constants
```

The grid prints, for the current shipped constants: per-dataset accuracy,
accuracy by decision source, escalation and inbox-fallback rates, and a
confusion list of every non-correct route.

## Finding: constants are embedding-model specific

First multi-model run (current shipped defaults; 23 grid fixtures across
flat-d1 / deep-d3 / failure-modes):

| Model | Current-defaults rank | Score (/155) | Grid-winner `lambda` | deep-d3 correct |
|---|---|---|---|---|
| `qwen3-embedding` | 621 / 4096 | 63.8 | 0.90 | 4/8 (50%) |
| `gemini-embedding-001@768` | 49 / 4096 | 52.8 | 1.00 | 0/8 (0%) |

The same constants behave very differently across models: on Gemini the
qwen3-era defaults collapse the deep taxonomy (every depth-3 email
over-escalates to review — 8/8 inbox_fallback), and the grid winner's depth
decay differs (`0.90` vs `1.00`). Absolute thresholds tuned on one embedding
model do not transfer.

### Recommendation

Two ways to make routing robust across deployed models:

- **(a) Per-provider constant sets.** Tune and ship one constant set per
  supported embedding model, selected at runtime by model id. Simple and
  low-risk, but every new model needs its own tuning pass and the constants
  multiply.
- **(b) Scale-invariant signals (preferred root-cause fix).** Replace the
  absolute thresholds (`THETA_MIN`, `THETA_DESCENT`) with signals that do not
  depend on a model's raw cosine scale — e.g. rank- or z-score-normalised
  similarities, or margins relative to the per-thread score distribution. One
  constant set would then generalise across models.

**Recommendation: pursue (b) as a short spike, with (a) as the interim.** Ship
a Gemini-tuned set now (interim, unblocks production on the model actually
deployed), and prototype scale-invariant signals against this benchmark — if a
single normalised config matches or beats the per-model winners on both qwen3
and Gemini, adopt it and retire the per-model sets. Do not change any constant
without re-running the grid on every deployed model (`BENCHMARK_EMBEDDING_MODEL`).

## Scale-invariant mode (B-lite + folded-in A) — prototype results

An opt-in decision path (`options.scaleInvariant`, off by default — the shipped
path is unchanged) replaces the absolute cross-branch gaps with per-thread
z-units (gap ÷ σ of the thread's similarities) and folds in the single-child fix:
a sole child is auto-entered only when it beats its parent by a clear z-margin,
otherwise the descend-vs-stay call escalates to the LLM. Run it with
`BENCHMARK_SCALE_INVARIANT=1` on either harness.

Grid results (current shipped constants, LLM stubbed):

| | qwen3 score / rank | Gemini score / rank | deep-d3 correct (Gemini) |
|---|---|---|---|
| Legacy (absolute) | 63.8 / 621 | 52.8 / 49 | 0/8 |
| **Scale-invariant** | **89.4 / 1** | **129.2 / 1** | **8/8** |

Key outcomes:
- **One config serves both models.** The current constants are rank 1/4096 on
  qwen3 AND Gemini in scale-invariant mode; the legacy per-model λ split (0.90 vs
  1.00) disappears and the absolute cross-branch margin becomes irrelevant.
- **Gemini deep-taxonomy collapse fixed.** deep-d3 goes 0/8 → 8/8 with zero
  escalation — the over-escalation caused by Gemini's compressed cosine band is gone.
- **LLM escalation cut ~75%** on the live reasoning benchmark (12 → 3 invoked on
  d1/d3/d2/origin) at the same 91% end-to-end accuracy.
- **Single-child bug fixed end-to-end.** With a real LLM, the generic-courier
  email resolves to the Deliveries parent and the genuine SwiftShip email to the
  SwiftShip leaf — the sole-child escalation makes the call cosine magnitude can't.

Remaining gap: the **off-topic quality gate** is still an absolute threshold and
still mishandles off-topic mail (the only non-ambiguous failures left are
off-topic cases). That is the irreducibly-absolute decision and the motivation
for B-full (mean-centering) if it needs closing.

To promote scale-invariant mode to production, flip the default (or pass
`scaleInvariant: true` from the worker) and update the legacy-threshold unit
tests deliberately — they assert the old absolute-gap behaviour.

## Known structural gap: single-child leaf (addressed by scale-invariant mode)

The `failure-modes` dataset encodes routing failures observed in real data, by
graph shape (deliberately NOT modelled on any user's taxonomy). The headline
one: a parent with exactly one child (a specific-vendor leaf) has no sibling to
trigger the cross-branch check, so the traversal descends into that leaf
unconditionally. `fm-generic-courier-tracking` (a non-vendor parcel that should
stay at the broad `Deliveries` parent) routes into the single `SwiftShip` child
under **every** grid config — proving this needs an algorithm change, not a
constant. The positive control `fm-swiftship-dispatch` (a genuine SwiftShip
parcel) routes correctly, so the fix must gate low-confidence descents into
single children, not block the leaf outright. Tracked as a follow-up; this
benchmark is the instrument to validate the fix.
