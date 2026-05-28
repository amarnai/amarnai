import type { SuggestedDraft } from "./selection";

type Props = {
  draft: SuggestedDraft;
};

export function SuggestedDraftCard({ draft }: Props) {
  return (
    <div className="em-draft-card">
      <div className="em-draft-eyebrow">{draft.eyebrow}</div>
      <div className="em-draft-title">{draft.title}</div>
      {draft.desc && <div className="em-draft-desc">{draft.desc}</div>}
    </div>
  );
}
