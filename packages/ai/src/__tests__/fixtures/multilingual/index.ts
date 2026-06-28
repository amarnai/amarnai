/**
 * Aggregated multilingual benchmark fixtures (B6), one file per supported locale.
 *
 * 100 LLM-generated (Claude, independent from the Gemini evaluator) labeled
 * threads across all 16 supported locales. Each thread carries a train/test
 * `split`: the grid search tunes only on "tune"; "holdout" is scored after the
 * config is chosen, so reported holdout accuracy is not contaminated by tuning.
 *
 * FLAT threads route against the flat taxonomy (ALL_NODES); D3 threads route
 * against the depth-3 taxonomy (ALL_NODES_D3). They are kept out of the keyless
 * qwen3 path: B5/B6 are judged on the production model (Gemini).
 *
 * Caveat: LLM-generated text is not real human email, and non-English content is
 * unreviewed except French. Treat results as relative (config vs config), not as
 * absolute production accuracy.
 */
import type { TestEmail } from "../sorting-fixtures.js";

import { THREADS_EN_FLAT, THREADS_EN_D3 } from "./en.js";
import { THREADS_DE_FLAT, THREADS_DE_D3 } from "./de.js";
import { THREADS_ES_FLAT, THREADS_ES_D3 } from "./es.js";
import { THREADS_FR_FLAT, THREADS_FR_D3 } from "./fr.js";
import { THREADS_ID_FLAT, THREADS_ID_D3 } from "./id.js";
import { THREADS_IT_FLAT, THREADS_IT_D3 } from "./it.js";
import { THREADS_JA_FLAT, THREADS_JA_D3 } from "./ja.js";
import { THREADS_KO_FLAT, THREADS_KO_D3 } from "./ko.js";
import { THREADS_NL_FLAT, THREADS_NL_D3 } from "./nl.js";
import { THREADS_PL_FLAT, THREADS_PL_D3 } from "./pl.js";
import { THREADS_PT_BR_FLAT, THREADS_PT_BR_D3 } from "./pt-BR.js";
import { THREADS_RU_FLAT, THREADS_RU_D3 } from "./ru.js";
import { THREADS_TH_FLAT, THREADS_TH_D3 } from "./th.js";
import { THREADS_TR_FLAT, THREADS_TR_D3 } from "./tr.js";
import { THREADS_VI_FLAT, THREADS_VI_D3 } from "./vi.js";
import { THREADS_ZH_CN_FLAT, THREADS_ZH_CN_D3 } from "./zh-CN.js";

/** Threads scored against the flat taxonomy (ALL_NODES / ALL_EDGES). */
export const ML_FLAT: TestEmail[] = [
  ...THREADS_EN_FLAT, ...THREADS_DE_FLAT, ...THREADS_ES_FLAT, ...THREADS_FR_FLAT,
  ...THREADS_ID_FLAT, ...THREADS_IT_FLAT, ...THREADS_JA_FLAT, ...THREADS_KO_FLAT,
  ...THREADS_NL_FLAT, ...THREADS_PL_FLAT, ...THREADS_PT_BR_FLAT, ...THREADS_RU_FLAT,
  ...THREADS_TH_FLAT, ...THREADS_TR_FLAT, ...THREADS_VI_FLAT, ...THREADS_ZH_CN_FLAT,
];

/** Threads scored against the depth-3 taxonomy (ALL_NODES_D3 / ALL_EDGES_D3). */
export const ML_D3: TestEmail[] = [
  ...THREADS_EN_D3, ...THREADS_DE_D3, ...THREADS_ES_D3, ...THREADS_FR_D3,
  ...THREADS_ID_D3, ...THREADS_IT_D3, ...THREADS_JA_D3, ...THREADS_KO_D3,
  ...THREADS_NL_D3, ...THREADS_PL_D3, ...THREADS_PT_BR_D3, ...THREADS_RU_D3,
  ...THREADS_TH_D3, ...THREADS_TR_D3, ...THREADS_VI_D3, ...THREADS_ZH_CN_D3,
];

/** Every multilingual fixture (flat + deep). */
export const ML_ALL: TestEmail[] = [...ML_FLAT, ...ML_D3];
