import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TAXONOMY_TEMPLATES } from "@amarnai/core/taxonomy";

// Guards against drift: every user-visible template string must have a `msg`
// declaration in taxonomy-template-messages.ts, or it will never reach the
// Lingui catalog and will render untranslated. We match against the raw source
// text (the declarations are extraction-only and not executed here).
describe("taxonomy template message declarations", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./taxonomy-template-messages.ts", import.meta.url)),
    "utf8",
  );

  // Every translatable string in the templates: picker name/description plus
  // each folder name/description. The root "Inbox" name is intentionally never
  // translated (see localizeTransferFile), so it is excluded.
  const expected = new Set<string>();
  for (const template of TAXONOMY_TEMPLATES) {
    expected.add(template.name);
    expected.add(template.description);
    for (const node of template.file.nodes) {
      if (!node.isRoot) expected.add(node.name);
      if (node.description != null) expected.add(node.description);
    }
  }

  it("declares every template string", () => {
    const missing = [...expected].filter((s) => !source.includes(s));
    expect(missing).toEqual([]);
  });
});
