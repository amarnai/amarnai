import type { MemberItem } from "./types.js";

// The shape both the workspaces API payload and the web app's Prisma member
// query share: one row per workspace member, each carrying its user.
export type MemberRow = {
  user: { id: string; email: string; name: string | null };
};

// Maps workspace-member rows to the MemberItem shape the assignee UI consumes.
// Dedupes by user id so a malformed payload can never render duplicate rows.
export function mapMembers(rows: MemberRow[]): MemberItem[] {
  const seen = new Set<string>();
  const members: MemberItem[] = [];
  for (const row of rows) {
    if (seen.has(row.user.id)) continue;
    seen.add(row.user.id);
    members.push({
      userId: row.user.id,
      name: row.user.name,
      email: row.user.email,
    });
  }
  return members;
}
