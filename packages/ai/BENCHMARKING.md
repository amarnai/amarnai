# Routing benchmark

Two harnesses tune and validate the embedding router (`src/embedding/sorter.ts`).
Both score the labeled email fixtures in `src/__tests__/fixtures/sorting-fixtures.ts`
across several taxonomy shapes (flat depth-1, deep depth-3, a domain-neutral
failure-mode taxonomy, and an origin-constrained taxonomy).

## Harnesses

| Script | What it tunes | LLM | Embeddings |
|---|---|---|---|
| `pnpm --filter @aziru/ai benchmark:constants` | The six sorter threshold constants (4,096-combo grid) | stubbed (always escalates) | pre-computed fixture |
| `pnpm --filter @aziru/ai benchmark:reasoning` | LLM reasoning-effort + prompt behaviour | live Gemini | live (prod-faithful) or fixture |

The grid stubs the LLM so its score reflects the embedding phase only. The
reasoning benchmark calls the live model, so it is the home for prompt-level
cases (e.g. origin-constrained nodes — Track P).

## Per-model fixtures

Cosine-similarity distributions differ by embedding model, so the grid is run
**per model**. Fixtures are one file per model: `embedding-vectors.<model>.json`.

Seed (env-driven, same factory as the runtime sorter):

```bash
# Default: qwen3 via Ollama (offline, keyless) — the CI smoke table
pnpm --filter @aziru/ai seed:embeddings

# Gemini (production model). Provide credentials via env (.env.local / Railway):
EMBEDDING_PROVIDER=frontier \
FRONTIER_EMBEDDING_PROVIDER=gemini \
FRONTIER_EMBEDDING_MODEL=gemini-embedding-001 \
FRONTIER_EMBEDDING_DIMENSIONS=768 \
FRONTIER_EMBEDDING_API_KEY=… \
pnpm --filter @aziru/ai seed:embeddings
```

Run the grid against a specific model's fixture:

```bash
pnpm --filter @aziru/ai benchmark:constants                                   # qwen3 (default)
BENCHMARK_EMBEDDING_MODEL='gemini-embedding-001@768' pnpm --filter @aziru/ai benchmark:constants
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

# Self-route metric, persistence rule, and baseline (B1/B2 Session 1)

This section is the measurement substrate and decision rules for evaluating the
proposed B1 (sender/entity tie-breaker gate) and B2 (BM25 hybrid ranking)
augmentations. It is model-pinned to production: all numbers below are on
`gemini-embedding-001@768`, mean-centered, scale-invariant (the shipped
`CENTERED_ROUTING_CONFIG`).

## Scope

We benchmark the sorting results our code produces **up to and including the
escalation decision**: confident auto-routes, deliberate Inbox stops, and (for
B1) local tie-resolutions. We do **not** grade the frontier LLM's answer on
escalated threads — its accuracy is out of our control. An escalation is a
hand-off (a cost), not a result we claim.

## The self-route metric (primary view)

Every thread falls in exactly one bucket (in the stubbed grid,
`llmCalled ⟹ needsHumanReview`, and `correct ⟹ committed`, so these partition):

- **committed** — we routed to a node (`needsHumanReview === false`).
- **escalated** — handed to the LLM (`llmCalled`). A cost.
- **declined** — sent to review without escalating (`needsHumanReview && !llmCalled`).

Reported (overall + per slice) by `printSelfRouteBreakdown` in
[src/__tests__/benchmark-constants.ts](src/__tests__/benchmark-constants.ts):

- **coverage** = committed / N — how often we route to a node at all
- **precision** = correct / committed — quality of the routes we commit to
- **self-route** = correct / N (= coverage × precision) — the headline accuracy
- **escalation** = escalated / N — the cost lever B1 targets
- **decline** = declined / N — self-declined to review, no LLM

The existing composite `POINTS` score is kept as a convenience sort only;
decisions use the decomposition above, not the fused scalar.

## Persistence test (the accuracy ratchet)

No change (B1, B2, or a constant retune) is kept unless **proven to improve
routing accuracy on the holdout split**. Default state is revert.

- Judged on **holdout only**, on the **Gemini fixture only** (`qwen3` is CI-smoke
  and can never justify a persistence decision).
- Test: McNemar paired test on the change's **targeted** holdout subpopulation —
  require p<0.05, ≥20 discordant pairs, net-positive flips, AND zero precision
  regression on the general holdout.
- The current holdout (37) is far too small for this; each feature must build its
  own powered, targeted subpopulation first (see roadmap).

## Decisions (Session 1, revisable)

1. **Ratchet semantics:** a self-route gain may come from **coverage** (correctly
   resolving would-be escalations locally) only under a **hard no-precision-
   regression guard**, proven on a powered subpopulation. Coverage and precision
   are reported separately so a coverage gain can never hide a precision drop.
2. **Selection criterion:** coverage-vs-precision Pareto on holdout is primary;
   the composite is convenience only, with `llmEscalation` to be raised from -0.2
   to a documented cost weight when used.
3. **Reasoning benchmark role:** retained as the realized-**cost** check (live
   escalation count / tokens), not an accuracy gate.

## Baseline (shipped `CENTERED_ROUTING_CONFIG`; holdout rebalanced — see assessment #1)

Split after rebalance: **82 tune / 46 holdout**, every taxonomy shape now in both.
Shipped config ranks 289/4096 on tune (score 432.6); holdout 37/46 (80%) vs grid
winner 36/46 (78%), so the shipped constants still generalise.

| Split | N | coverage | precision | self-route | escalation | decline |
|---|---|---|---|---|---|---|
| TUNE | 82 | 85% | 99% | 84% | 15% | 0% |
| HOLDOUT | 46 | 80% | 100% | 80% | 15% | 4% |

Per-slice self-route (HOLDOUT): flat-d1 75%, ml-flat 82%, deep-d3 100%, ml-d3
100%, fwd 100%, **failure-modes 0%** (2 structural cases, both escalate).
Precision is **100% on holdout** — zero misroutes; every loss is a hand-off
(escalate/decline), not a wrong route. **Headroom for B1:** holdout escalation is
15% (7/46), all on deliberately-ambiguous or structural fixtures; tune escalation
is dominated by the multilingual customer-support cluster below.

## Current-algorithm assessment (Session 1, Task D)

Candidate adjustments from the baseline, independent of B1/B2. Tags:
**data-artifact** / **tunable-constant** / **algorithm-change**.

1. **[P1, data-artifact] Holdout was unrepresentative — RESOLVED.** The original
   37 holdout fixtures had **zero** `deep-d3`, `failure-modes`, or `flat-d1`, so
   persistence decisions were blind to deep-taxonomy and structural regressions.
   Re-tagged 9 fixtures (4 flat-d1, 3 deep-d3, 2 failure-modes) into holdout →
   now 82 tune / 46 holdout with every shape in both (no re-seed needed). Residual
   caveat: `failure-modes` holdout is only 2 cases and `ml-d3` only 1, so those
   slices stay statistically thin — grow them with new fixtures (+ re-seed) when a
   change targets them.
2. **[P1, algorithm-change] Off-topic quality gate miss.** `fm-offtopic-digest`
   confidently routes to Community (`embedding_auto`) — the **only** true misroute
   in 91 tune fixtures. The mean-centered gate doesn't catch off-topic mail
   (a known, documented gap). Any fix must not regress the 90 correct routes;
   power is low (few off-topic fixtures), so pair with more off-topic cases.
3. **[P2, investigate → tunable-constant or node-text] Multilingual
   customer-support under-routing.** ~10 non-English customer-support threads
   escalate/decline instead of committing to Customer Support (precision stays
   100% — pure coverage loss). Largest systematic coverage drag and measurable
   (10+ cases). The 6-constant grid does not fix it (the grid winner escalates
   *more* and is worse on holdout), so it likely needs a node-embedding-text
   improvement or a targeted cross-branch/descent change; B1/B2 may also help.
4. **[P3, data-artifact / metric] Off-topic fixtures expect a node, not null.**
   Off-topic cases (`unclassifiable-off-topic`, `fm-offtopic-digest`) expect an
   "Other / Needs Review" node or Inbox, but a correct decline yields `null` and
   is scored as a miss. Decide whether a correct decline-to-review should be
   credited, else the metric under-credits correct off-topic handling.
5. **[P4, algorithm-change, documented] Single-child / specific-vendor leaf.**
   `fm-generic-courier-tracking` — already a tracked follow-up (see the
   single-child section above). Low priority here.

Session 1 makes no algorithm change: none of the above is a high-confidence,
broadly-applicable one-liner. Items 1 and 3 are the highest-value next steps and
are scoped as their own work.
