import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@amarnai/db";
import { requireUser } from "@/lib/session";
import { isWaitlistAdmin } from "@/lib/waitlist";
import { toggleWaitlistInvitedAction } from "@/actions/waitlist";
import { AuthShell } from "@/components/AuthShell";

type Entry = { id: string; email: string; createdAt: Date; invitedAt: Date | null };

// "Invited" is manual bookkeeping: marking an entry here does not touch the
// Google test-user allowlist — add the address in the Cloud Console and email
// the invite yourself, then mark it so it leaves the pending section.
function EntryRow({ entry }: { entry: Entry }) {
  return (
    <li style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
      <span style={{ flex: 1, overflowWrap: "anywhere" }}>{entry.email}</span>
      <span className="auth-hint" style={{ whiteSpace: "nowrap" }}>
        {(entry.invitedAt ?? entry.createdAt).toISOString().slice(0, 10)}
      </span>
      <form action={toggleWaitlistInvitedAction}>
        <input type="hidden" name="id" value={entry.id} />
        <button type="submit" className="btn-ghost btn-sm">
          {entry.invitedAt ? "Undo" : "Mark invited"}
        </button>
      </form>
    </li>
  );
}

function EntryList({ entries }: { entries: Entry[] }) {
  return (
    <ul className="auth-form" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {entries.map((entry) => (
        <EntryRow key={entry.id} entry={entry} />
      ))}
    </ul>
  );
}

export default async function AdminWaitlistPage() {
  const user = await requireUser();
  if (!isWaitlistAdmin(user.email)) notFound();

  const entries = await db.waitlistEntry.findMany({ orderBy: { createdAt: "desc" } });
  const pending = entries.filter((e) => !e.invitedAt);
  const invited = entries.filter((e) => e.invitedAt);

  return (
    <AuthShell title="Waitlist" subtitle={`${pending.length} pending · ${invited.length} invited`}>
      <Link href="/emails" className="btn-ghost btn-sm" style={{ alignSelf: "flex-start" }}>
        ← Back
      </Link>
      {entries.length === 0 ? (
        <p className="auth-hint">No signups yet.</p>
      ) : (
        <>
          {pending.length > 0 && (
            <>
              <h2 className="form-label">Pending</h2>
              <EntryList entries={pending} />
            </>
          )}
          {invited.length > 0 && (
            <>
              <h2 className="form-label" style={{ marginTop: "1.5rem" }}>
                Invited
              </h2>
              <EntryList entries={invited} />
            </>
          )}
        </>
      )}
    </AuthShell>
  );
}
