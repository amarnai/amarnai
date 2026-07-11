"use client";

import { useState, useTransition, useRef } from "react";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { msg } from "@lingui/core/macro";
import { api } from "@/lib/api";

type Props = {
  workspaceId: string;
  initialEmails: string[];
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function EmailBlacklistSection({ workspaceId, initialEmails }: Props) {
  const { _ } = useLingui();
  const [emails, setEmails] = useState<string[]>(initialEmails);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleAdd() {
    const email = input.trim().toLowerCase();
    if (!isValidEmail(email)) {
      setError(_(msg`Enter a valid email address.`));
      return;
    }
    if (emails.includes(email)) {
      setError(_(msg`Already in the list.`));
      return;
    }
    setError(null);
    setEmails((prev) => [...prev, email]);
    setInput("");

    startTransition(async () => {
      try {
        const updated = await api.addBlacklistedEmail(workspaceId, email);
        setEmails(updated.blacklistedSenderEmails);
      } catch {
        setEmails((prev) => prev.filter((e) => e !== email));
        setError(_(msg`Could not add email. Please try again.`));
      }
    });

    inputRef.current?.focus();
  }

  function handleRemove(email: string) {
    setEmails((prev) => prev.filter((e) => e !== email));

    startTransition(async () => {
      try {
        const updated = await api.removeBlacklistedEmail(workspaceId, email);
        setEmails(updated.blacklistedSenderEmails);
      } catch {
        setEmails((prev) => [...prev, email]);
        setError(_(msg`Could not remove email. Please try again.`));
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  }

  return (
    <details className="settings-section settings-collapsible">
      <summary className="settings-collapsible-summary">
        <h2><Trans>Sender Blacklist</Trans></h2>
        {emails.length > 0 && (
          <span className="settings-collapsible-count">{emails.length}</span>
        )}
      </summary>

      <p className="settings-hint">
        <Trans>
          Threads from these senders will never be imported or sorted by Amarnai.
        </Trans>
      </p>

      <div className="blacklist-input-row">
        <input
          ref={inputRef}
          className="blacklist-input"
          type="email"
          placeholder="sender@example.com"
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(null); }}
          onKeyDown={handleKeyDown}
          disabled={isPending}
          aria-label={_(msg`Email address to blacklist`)}
        />
        <button
          className="btn-secondary"
          type="button"
          onClick={handleAdd}
          disabled={isPending || input.trim() === ""}
        >
          <Trans>Add</Trans>
        </button>
      </div>

      {error && <p className="blacklist-error">{error}</p>}

      {emails.length > 0 && (
        <ul className="blacklist-pills">
          {emails.map((email) => (
            <li key={email} className="blacklist-pill">
              <span className="blacklist-pill-email">{email}</span>
              <button
                className="blacklist-pill-remove"
                type="button"
                onClick={() => handleRemove(email)}
                disabled={isPending}
                aria-label={_(msg`Remove ${email} from blacklist`)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
