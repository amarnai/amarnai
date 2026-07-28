"use client";

import { useEffect, useMemo, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import type { TaxonomyTransferFile } from "@amarnai/shared";
import type { ApiClient } from "@amarnai/api-client";
import { TAXONOMY_TEMPLATES, localizeTemplate } from "@amarnai/core/taxonomy";
import { translateSource } from "@amarnai/i18n";

type Props = {
  api: ApiClient;
  workspaceId: string;
  onSelect: (file: TaxonomyTransferFile) => void;
};

/**
 * The built-in sorting-plan templates, best match first.
 *
 * Templates are English data living outside the Lingui extract paths, so their
 * picker copy and every folder name is localized here through translateSource
 * against the mirrored declarations in ../i18n/taxonomy-template-messages.ts.
 * Display and apply run off the same localized object, so the names the user
 * picks are the names that get stored (see localizeTemplate).
 */
export function TemplatePicker({ api, workspaceId, onSelect }: Props) {
  const { i18n } = useLingui();
  const [recommendedId, setRecommendedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .taxonomyTemplateRecommendation(workspaceId)
      .then((r) => {
        if (!cancelled) setRecommendedId(r.recommendedTemplateId);
      })
      // The badge is progressive enhancement: never block the picker on it.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, workspaceId]);

  const templates = useMemo(
    () => TAXONOMY_TEMPLATES.map((t) => localizeTemplate(t, (s) => translateSource(i18n, s))),
    [i18n],
  );

  const ordered = useMemo(() => {
    const recommended = templates.find((t) => t.id === recommendedId);
    if (!recommended) return templates;
    return [recommended, ...templates.filter((t) => t.id !== recommendedId)];
  }, [templates, recommendedId]);

  return (
    <ul className="ps-templates">
      {ordered.map((t) => (
        <li key={t.id}>
          <button type="button" className="ps-template" onClick={() => onSelect(t.file)}>
            <span className="ps-template-head">
              <span className="ps-template-name">{t.name}</span>
              {t.id === recommendedId && (
                <span className="ps-badge">
                  <Trans>Recommended</Trans>
                </span>
              )}
            </span>
            <span className="ps-template-desc">{t.description}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
