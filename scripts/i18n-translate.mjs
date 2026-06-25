#!/usr/bin/env node
/**
 * i18n-translate — AI-powered fill of missing PO catalog translations.
 *
 * Reads each non-source locale's messages.po, finds entries where msgstr is
 * empty (untranslated), batches them to the configured LLM, validates the
 * response with Zod (same keys, ICU placeholders preserved, no injected keys),
 * and writes translations back as fuzzy entries for optional human review.
 *
 * Usage: node scripts/i18n-translate.mjs [--locale fr] [--dry-run]
 *
 * Falls back gracefully if no AI provider is reachable (leaves msgstr empty,
 * logs a warning) so offline / keyless dev environments are never blocked.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── Env loading ───────────────────────────────────────────────────────────────

function loadEnv(key) {
  if (process.env[key]) return process.env[key];
  for (const file of [".env.local", ".env"]) {
    const path = resolve(ROOT, file);
    if (!existsSync(path)) continue;
    const line = readFileSync(path, "utf8")
      .split("\n")
      .find((l) => l.startsWith(`${key}=`));
    if (line) return line.slice(key.length + 1).trim();
  }
  return null;
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const targetLocaleArg = (() => {
  const idx = args.indexOf("--locale");
  return idx !== -1 ? args[idx + 1] : null;
})();

// ── Locale list (read from the package's locales.ts via plain file parse) ─────
// We cannot import TS directly in a plain .mjs; read the constant from the file.

const LOCALES_FILE = resolve(ROOT, "packages/i18n/src/locales.ts");
const localesSource = readFileSync(LOCALES_FILE, "utf8");
const localesMatch = localesSource.match(
  /SUPPORTED_LOCALES\s*=\s*\[([\s\S]*?)\]/
);
if (!localesMatch) {
  console.error("Could not parse SUPPORTED_LOCALES from locales.ts");
  process.exit(1);
}
const SUPPORTED_LOCALES = localesMatch[1]
  .split(",")
  .map((s) => s.replace(/['"]/g, "").trim())
  .filter(Boolean);

const SOURCE_LOCALE = "en";
const TARGET_LOCALES = SUPPORTED_LOCALES.filter((l) => l !== SOURCE_LOCALE);
const activeLocales = targetLocaleArg
  ? [targetLocaleArg]
  : TARGET_LOCALES;

// ── PO parsing/writing (minimal — we only need msgid/msgstr) ─────────────────

function parsePo(content) {
  const entries = [];
  const blocks = content.split(/\n(?=msgid )/);
  for (const block of blocks) {
    if (!block.trim() || block.startsWith('msgid ""')) {
      // header block
      entries.push({ isHeader: true, raw: block });
      continue;
    }

    const msgidMatch = block.match(/^msgid "((?:[^"\\]|\\.)*)"/ms);
    const msgstrMatch = block.match(/\nmsgstr "((?:[^"\\]|\\.)*)"/ms);
    const isFuzzy = block.includes("#, fuzzy");

    if (!msgidMatch) {
      entries.push({ isHeader: false, raw: block, msgid: null, msgstr: null, isFuzzy });
      continue;
    }

    const msgid = msgidMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    const msgstr = msgstrMatch
      ? msgstrMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"')
      : "";

    entries.push({ isHeader: false, raw: block, msgid, msgstr, isFuzzy });
  }
  return entries;
}

function escapePoStr(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function writePo(entries) {
  return entries
    .map((entry) => {
      if (entry.isHeader || entry.msgid === null) return entry.raw;
      // Re-emit block with potentially updated msgstr
      let block = entry.raw;
      const msgstrLine = `msgstr "${escapePoStr(entry.msgstr)}"`;
      block = block.replace(/\nmsgstr "(?:[^"\\]|\\.)*"/ms, "\n" + msgstrLine);
      // Ensure fuzzy flag is present
      if (entry.needsFuzzy && !block.includes("#, fuzzy")) {
        block = "#, fuzzy\n" + block.replace(/^#, fuzzy\n/m, "");
      }
      return block;
    })
    .join("\n");
}

// ── ICU placeholder extraction ────────────────────────────────────────────────

function extractPlaceholders(str) {
  // Extract ICU argument placeholders as {name} tokens, ignoring the literal
  // text inside plural/select sub-messages. A naive /\{(\w+)/ regex wrongly
  // treats the first word of an arm (e.g. `one {Deleting this folder...}`) as a
  // placeholder, failing valid translations; we walk the ICU structure instead.
  // Keep in sync with packages/i18n/src/validate-translations.ts (source of truth).
  const placeholders = new Set();
  const n = str.length;
  let i = 0;

  const isWord = (c) => /\w/.test(c);
  const skipSpace = () => {
    while (i < n && /\s/.test(str.charAt(i))) i++;
  };

  const parseMessage = () => {
    while (i < n) {
      const c = str.charAt(i);
      if (c === "}") return;
      if (c === "{") {
        parseArgument();
        continue;
      }
      i++;
    }
  };

  const parseArgument = () => {
    i++; // consume `{`
    skipSpace();
    const start = i;
    while (i < n && isWord(str.charAt(i))) i++;
    const name = str.slice(start, i);
    if (name) placeholders.add(`{${name}}`);
    skipSpace();
    if (str.charAt(i) === ",") {
      i++; // consume `,`
      skipSpace();
      const typeStart = i;
      while (i < n && isWord(str.charAt(i))) i++;
      const type = str.slice(typeStart, i);
      if (type === "plural" || type === "select" || type === "selectordinal") {
        skipSpace();
        if (str.charAt(i) === ",") i++;
        parseArms();
      } else {
        skipStyle();
      }
    }
    if (str.charAt(i) === "}") i++; // consume the argument's closing `}`
  };

  const parseArms = () => {
    while (i < n) {
      skipSpace();
      if (i >= n || str.charAt(i) === "}") return;
      while (i < n && !/\s/.test(str.charAt(i)) && str.charAt(i) !== "{" && str.charAt(i) !== "}") i++;
      skipSpace();
      if (str.charAt(i) !== "{") return; // malformed — bail
      i++; // consume arm `{`
      parseMessage();
      if (str.charAt(i) === "}") i++; // consume arm `}`
    }
  };

  const skipStyle = () => {
    let depth = 0;
    while (i < n) {
      const c = str.charAt(i);
      if (c === "{") depth++;
      else if (c === "}") {
        if (depth === 0) return;
        depth--;
      }
      i++;
    }
  };

  parseMessage();
  return placeholders;
}

// ── Zod validation for AI response ───────────────────────────────────────────

function buildTranslationSchema(sourceEntries) {
  const shape = {};
  for (const { msgid } of sourceEntries) {
    shape[msgid] = z.string().min(1);
  }
  return z.object(shape).strict();
}

function validateTranslations(raw, sourceEntries) {
  const schema = buildTranslationSchema(sourceEntries);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  // Per-entry ICU placeholder check
  for (const { msgid } of sourceEntries) {
    const sourcePlaceholders = extractPlaceholders(msgid);
    const translationPlaceholders = extractPlaceholders(parsed.data[msgid]);
    for (const ph of sourcePlaceholders) {
      if (!translationPlaceholders.has(ph)) {
        return {
          ok: false,
          error: `Placeholder ${ph} missing from translation of: "${msgid.slice(0, 60)}"`,
        };
      }
    }
  }
  return { ok: true, data: parsed.data };
}

// ── AI provider (dynamic import so the script can warn + skip if unavailable) ─

async function buildProvider() {
  // Mirror packages/config's AI_PROVIDER contract: mock | ollama | frontier.
  // Only `frontier` performs a real LLM call here; the frontier *vendor*
  // (gemini, openai, …) is set via FRONTIER_LLM_PROVIDER, not AI_PROVIDER.
  const aiProvider = loadEnv("AI_PROVIDER") ?? "mock";
  const VALID_PROVIDERS = ["mock", "ollama", "frontier"];
  if (!VALID_PROVIDERS.includes(aiProvider)) {
    console.warn(
      `[i18n-translate] Invalid AI_PROVIDER "${aiProvider}" (expected ${VALID_PROVIDERS.join(" | ")}); leaving untranslated. Set AI_PROVIDER=frontier with FRONTIER_LLM_PROVIDER for AI fills.`
    );
    return null;
  }
  if (aiProvider !== "frontier") return null;

  try {
    // Import the compiled JS if available (build-time ts-node not guaranteed).
    // We'll use tsx via the package's own node_modules if available, otherwise
    // fall back to a direct REST call pattern. For simplicity, inline the
    // frontier call here rather than depending on TS compilation.
    const frontierKey = loadEnv("FRONTIER_LLM_API_KEY");
    const frontierModel = loadEnv("FRONTIER_LLM_MODEL") ?? "gemini-2.0-flash";
    const frontierProvider = loadEnv("FRONTIER_LLM_PROVIDER") ?? "gemini";
    const frontierBaseUrl =
      loadEnv("FRONTIER_LLM_BASE_URL") ??
      (frontierProvider === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta/openai"
        : undefined);

    if (!frontierKey) return null;

    return {
      modelName: frontierModel,
      providerName: frontierProvider,
      async chat(messages) {
        const { default: OpenAI } = await import("openai");
        const client = new OpenAI({
          apiKey: frontierKey,
          baseURL: frontierBaseUrl,
        });
        const completion = await client.chat.completions.create({
          model: frontierModel,
          messages,
          response_format: { type: "json_object" },
        });
        const content = completion.choices[0]?.message?.content;
        if (typeof content !== "string") throw new Error("No content from LLM");
        return content;
      },
    };
  } catch (e) {
    console.warn(`[i18n-translate] Could not init AI provider: ${e.message}`);
    return null;
  }
}

// ── Build translation prompt ──────────────────────────────────────────────────

function buildPrompt(locale, batch) {
  const localeNames = {
    fr: "French",
    es: "Spanish",
    de: "German",
    "pt-BR": "Brazilian Portuguese",
    it: "Italian",
    nl: "Dutch",
    ja: "Japanese",
    "zh-CN": "Simplified Chinese",
  };
  const targetName = localeNames[locale] ?? locale;

  // Address strings by numeric ID (the entry's index in the batch) rather than
  // echoing the full English source as a JSON key. The English text stays as the
  // value so the model still sees the source as its translation anchor, but the
  // response only has to reproduce short numeric keys — cutting output tokens and
  // avoiding batch drops from verbatim-key drift. The caller remaps IDs back to
  // msgids before validation.
  const input = Object.fromEntries(batch.map(({ msgid }, i) => [String(i), msgid]));

  return [
    {
      role: "system",
      content: `You are a professional UI translator. Translate UI strings from English to ${targetName}.

RULES:
- The input is a JSON object whose keys are numeric IDs and whose values are English strings.
- Return a JSON object whose keys are the SAME numeric IDs and whose values are the ${targetName} translation of the corresponding English string.
- Include EVERY ID from the input — no additions, no omissions.
- Preserve ALL ICU MessageFormat placeholders exactly ({count}, {name}, {count, plural, one{...} other{...}}, etc.).
- Preserve ALL HTML/JSX-style tags (e.g. <strong>, </em>).
- Keep translations natural and concise — this is UI copy, not prose.
- Do NOT add explanatory text outside the JSON.`,
    },
    {
      role: "user",
      content: `Translate these strings to ${targetName}:\n${JSON.stringify(input, null, 2)}`,
    },
  ];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const provider = await buildProvider();
  if (!provider) {
    console.warn(
      "[i18n-translate] No AI provider available (set AI_PROVIDER and FRONTIER_LLM_API_KEY or start Ollama). " +
        "Skipping translation fill — untranslated strings will fall back to English at runtime."
    );
    return;
  }

  console.log(
    `[i18n-translate] Using ${provider.providerName}/${provider.modelName}`
  );

  const BATCH_SIZE = 40;
  const localesDir = resolve(ROOT, "packages/i18n/src/locales");
  let totalTranslated = 0;
  let totalSkipped = 0;

  for (const locale of activeLocales) {
    const poPath = resolve(localesDir, locale, "messages.po");
    if (!existsSync(poPath)) {
      console.warn(`[i18n-translate] Catalog not found: ${poPath}, skipping.`);
      continue;
    }

    const content = readFileSync(poPath, "utf8");
    const entries = parsePo(content);
    const untranslated = entries.filter(
      (e) => !e.isHeader && e.msgid && !e.msgstr
    );

    if (untranslated.length === 0) {
      console.log(`[i18n-translate] ${locale}: already complete, skipping.`);
      continue;
    }

    console.log(
      `[i18n-translate] ${locale}: ${untranslated.length} strings to translate...`
    );

    // Process in batches
    for (let i = 0; i < untranslated.length; i += BATCH_SIZE) {
      const batch = untranslated.slice(i, i + BATCH_SIZE);
      const batchLabel = `${locale} [${i + 1}-${Math.min(i + BATCH_SIZE, untranslated.length)}/${untranslated.length}]`;

      let rawResponse;
      try {
        const messages = buildPrompt(locale, batch);
        rawResponse = await provider.chat(messages);
      } catch (e) {
        console.warn(
          `[i18n-translate] ${batchLabel}: AI call failed (${e.message}), leaving untranslated.`
        );
        totalSkipped += batch.length;
        continue;
      }

      let parsed;
      try {
        parsed = JSON.parse(rawResponse);
      } catch {
        console.warn(
          `[i18n-translate] ${batchLabel}: response is not valid JSON, leaving untranslated.`
        );
        totalSkipped += batch.length;
        continue;
      }

      // The model replies keyed by numeric ID (the batch index). Verify the
      // returned ID set matches exactly — no missing, no extra — then remap to a
      // msgid-keyed object so the existing msgid-based validation runs unchanged.
      const byMsgid = {};
      let idSetOk =
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        Object.keys(parsed).length === batch.length;
      if (idSetOk) {
        for (let j = 0; j < batch.length; j++) {
          if (!Object.prototype.hasOwnProperty.call(parsed, String(j))) {
            idSetOk = false;
            break;
          }
          byMsgid[batch[j].msgid] = parsed[String(j)];
        }
      }
      if (!idSetOk) {
        console.warn(
          `[i18n-translate] ${batchLabel}: response IDs do not match the input, leaving untranslated.`
        );
        totalSkipped += batch.length;
        continue;
      }

      const validation = validateTranslations(byMsgid, batch);
      if (!validation.ok) {
        console.warn(
          `[i18n-translate] ${batchLabel}: validation failed (${validation.error}), leaving untranslated.`
        );
        totalSkipped += batch.length;
        continue;
      }

      // Write translations back into entries
      for (const entry of batch) {
        const translation = validation.data[entry.msgid];
        if (translation) {
          entry.msgstr = translation;
          entry.needsFuzzy = true;
        }
      }
      totalTranslated += batch.length;
      console.log(`[i18n-translate] ${batchLabel}: done.`);
    }

    if (!dryRun) {
      writeFileSync(poPath, writePo(entries), "utf8");
    }
  }

  console.log(
    `[i18n-translate] Complete. Translated: ${totalTranslated}, skipped: ${totalSkipped}.${dryRun ? " (dry run — no files written)" : ""}`
  );
}

main().catch((e) => {
  console.error("[i18n-translate] Fatal:", e);
  process.exit(1);
});
