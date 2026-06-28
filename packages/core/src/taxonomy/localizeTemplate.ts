import type { TaxonomyTemplate } from "./templates.js";
import { localizeTransferFile, type Translate } from "./localizeTransferFile.js";

/**
 * Returns a copy of a template with its picker `name`/`description` and every
 * folder name/description in its `file` mapped through `translate`.
 *
 * Display, apply, and `matchesTemplate` must all run a template through this
 * helper with the same `translate`, so the names a user sees, the names
 * persisted on apply, and the names compared to detect the "current" template
 * stay identical. See matchesTemplate.ts (compares by node name).
 */
export function localizeTemplate(
  template: TaxonomyTemplate,
  translate: Translate,
): TaxonomyTemplate {
  return {
    ...template,
    name: translate(template.name),
    description: translate(template.description),
    file: localizeTransferFile(template.file, translate),
  };
}
