"use client";

import { useState, useTransition, useRef } from "react";

const API_BASE =
  typeof window !== "undefined"
    ? (process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001")
    : "http://localhost:3001";

type Props = {
  workspaceId: string;
  initialEmails: string[];
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function EmailBlacklistSection({ workspaceId, initialEmails }: Props) {
  const [emails, setEmails] = useState<string[]>(initialEmails);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function handleAdd() {
    const email = input.trim().toLowerCase();
    if (!isValidEmail(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (emails.includes(email)) {
      setError("Already in the list.");
      return;
    }
    setError(null);
    setEmails((prev) => [...prev, email]);
    setInput("");

    startTransition(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/workspaces/${workspaceId}/gmail-sync-settings/blacklist`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          }
        );
        if (!res.ok) throw new Error();
        const updated = (await res.json()) as { blacklistedSenderEmails: string[] };
        setEmails(updated.blacklistedSenderEmails);
      } catch {
        setEmails((prev) => prev.filter((e) => e !== email));
        setError("Could not add email. Please try again.");
      }
    });

    inputRef.current?.focus();
  }

  function handleRemove(email: string) {
    setEmails((prev) => prev.filter((e) => e !== email));

    startTransition(async () => {
      try {
        const res = await fetch(
          `${API_BASE}/workspaces/${workspaceId}/gmail-sync-settings/blacklist/${encodeURIComponent(email)}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error();
        const updated = (await res.json()) as { blacklistedSenderEmails: string[] };
        setEmails(updated.blacklistedSenderEmails);
      } catch {
        setEmails((prev) => [...prev, email]);
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
        <h2>Sender Blacklist</h2>
        {emails.length > 0 && (
          <span className="settings-collapsible-count">{emails.length}</span>
        )}
      </summary>

      <p className="settings-hint">
        Threads from these senders will never be imported or sorted by Amarnai.
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
          aria-label="Email address to blacklist"
        />
        <button
          className="btn-secondary"
          type="button"
          onClick={handleAdd}
          disabled={isPending || input.trim() === ""}
        >
          Add
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
                aria-label={`Remove ${email} from blacklist`}
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
