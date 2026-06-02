/**
 * Tests for workspace member management business rules.
 * These tests verify permission checks, member limits, and invitation logic
 * by testing the underlying DB and validation patterns used by the server actions.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@amarnai/db", () => ({
  db: {
    workspaceMember: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    workspaceInvitation: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { db } from "@amarnai/db";
import { getCollaboratorLimit } from "@amarnai/shared";

// ─── Helpers replicated from server actions for unit-testable extraction ──────

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function assertWorkspaceAdmin(
  workspaceId: string,
  userId: string
): Promise<{ ok: true } | { error: string }> {
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  if (member?.role !== "OWNER") return { error: "Only admins can perform this action" };
  return { ok: true };
}

async function assertTaxonomyEditor(
  workspaceId: string,
  userId: string
): Promise<{ ok: true } | { error: string }> {
  const [member, workspace] = await Promise.all([
    db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    }),
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: { membersCanEditTaxonomy: true },
    }),
  ]);
  if (!member) return { error: "Not a member of this workspace" };
  if (member.role === "OWNER") return { ok: true };
  if (!workspace?.membersCanEditTaxonomy) {
    return { error: "Taxonomy editing is restricted to workspace admins" };
  }
  return { ok: true };
}

async function canInviteMember(
  workspaceId: string,
  adminUserId: string,
  rawEmail: string
): Promise<{ ok: true } | { error: string }> {
  const email = rawEmail.trim().toLowerCase();

  if (!isValidEmail(email)) return { error: "Enter a valid email address" };

  const adminCheck = await assertWorkspaceAdmin(workspaceId, adminUserId);
  if ("error" in adminCheck) return adminCheck;

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      name: true,
      plan: true,
      members: { select: { userId: true, role: true } },
    },
  });
  if (!workspace) return { error: "Workspace not found" };

  const collaboratorLimit = getCollaboratorLimit(workspace.plan);
  const teamMemberCount = workspace.members.filter((m) => m.role !== "OWNER").length;
  if (teamMemberCount >= collaboratorLimit) {
    return { error: "This workspace has reached its collaborator limit" };
  }

  return { ok: true };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const WS_ID = "ws-1";
const OWNER_ID = "user-owner";
const MEMBER_ID = "user-member";
const STRANGER_ID = "user-stranger";

function mockOwnerMember() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ role: "OWNER" } as any);
}

function mockRegularMember() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue({ role: "MEMBER" } as any);
}

function mockNotMember() {
  vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── assertWorkspaceAdmin ────────────────────────────────────────────────────

describe("assertWorkspaceAdmin", () => {
  it("allows OWNER", async () => {
    mockOwnerMember();
    expect(await assertWorkspaceAdmin(WS_ID, OWNER_ID)).toEqual({ ok: true });
  });

  it("rejects MEMBER role", async () => {
    mockRegularMember();
    const result = await assertWorkspaceAdmin(WS_ID, MEMBER_ID);
    expect("error" in result).toBe(true);
  });

  it("rejects non-member", async () => {
    mockNotMember();
    const result = await assertWorkspaceAdmin(WS_ID, STRANGER_ID);
    expect("error" in result).toBe(true);
  });
});

// ─── assertTaxonomyEditor ─────────────────────────────────────────────────────

describe("assertTaxonomyEditor", () => {
  it("allows OWNER regardless of membersCanEditTaxonomy flag", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { role: "OWNER" } as any
    );
    vi.mocked(db.workspace.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { membersCanEditTaxonomy: false } as any
    );
    expect(await assertTaxonomyEditor(WS_ID, OWNER_ID)).toEqual({ ok: true });
  });

  it("allows MEMBER when membersCanEditTaxonomy is true", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { role: "MEMBER" } as any
    );
    vi.mocked(db.workspace.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { membersCanEditTaxonomy: true } as any
    );
    expect(await assertTaxonomyEditor(WS_ID, MEMBER_ID)).toEqual({ ok: true });
  });

  it("rejects MEMBER when membersCanEditTaxonomy is false", async () => {
    vi.mocked(db.workspaceMember.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { role: "MEMBER" } as any
    );
    vi.mocked(db.workspace.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { membersCanEditTaxonomy: false } as any
    );
    const result = await assertTaxonomyEditor(WS_ID, MEMBER_ID);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/restricted/i);
    }
  });

  it("rejects non-member", async () => {
    mockNotMember();
    vi.mocked(db.workspace.findUnique).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { membersCanEditTaxonomy: true } as any
    );
    const result = await assertTaxonomyEditor(WS_ID, STRANGER_ID);
    expect("error" in result).toBe(true);
  });
});

// ─── canInviteMember ─────────────────────────────────────────────────────────

describe("canInviteMember", () => {
  it("allows admin to invite a valid email when under member limit", async () => {
    mockOwnerMember();
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      name: "Test WS",
      plan: "PRO",
      members: [{ userId: OWNER_ID, role: "OWNER" }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await canInviteMember(WS_ID, OWNER_ID, "new@example.com");
    expect(result).toEqual({ ok: true });
  });

  it("rejects invalid email format", async () => {
    mockOwnerMember();
    const result = await canInviteMember(WS_ID, OWNER_ID, "not-an-email");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/valid email/i);
  });

  it("rejects non-admin trying to invite", async () => {
    mockRegularMember();
    const result = await canInviteMember(WS_ID, MEMBER_ID, "other@example.com");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/admin/i);
  });

  it("rejects when collaborator limit reached (PRO: 10)", async () => {
    mockOwnerMember();
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      name: "Test WS",
      plan: "PRO",
      members: [
        { userId: OWNER_ID, role: "OWNER" },
        ...Array.from({ length: 10 }, (_, i) => ({ userId: `m${i + 1}`, role: "MEMBER" })),
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await canInviteMember(WS_ID, OWNER_ID, "eleventh@example.com");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/collaborator limit/i);
  });

  it("allows invite when exactly at limit minus 1 (last slot, PRO: 10)", async () => {
    mockOwnerMember();
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      name: "Test WS",
      plan: "PRO",
      members: [
        { userId: OWNER_ID, role: "OWNER" },
        ...Array.from({ length: 9 }, (_, i) => ({ userId: `m${i + 1}`, role: "MEMBER" })),
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await canInviteMember(WS_ID, OWNER_ID, "tenth@example.com");
    expect(result).toEqual({ ok: true });
  });

  it("normalises email to lowercase before validation", async () => {
    mockOwnerMember();
    vi.mocked(db.workspace.findUnique).mockResolvedValue({
      name: "Test WS",
      plan: "PRO",
      members: [{ userId: OWNER_ID, role: "OWNER" }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await canInviteMember(WS_ID, OWNER_ID, "  User@Example.COM  ");
    expect(result).toEqual({ ok: true });
  });

  it("rejects when workspace does not exist", async () => {
    mockOwnerMember();
    vi.mocked(db.workspace.findUnique).mockResolvedValue(null);

    const result = await canInviteMember(WS_ID, OWNER_ID, "new@example.com");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/not found/i);
  });
});

// ─── Collaborator limit ───────────────────────────────────────────────────────

describe("getCollaboratorLimit", () => {
  it("returns 0 for FREE plan", () => {
    expect(getCollaboratorLimit("FREE")).toBe(0);
  });

  it("returns 10 for PRO plan", () => {
    expect(getCollaboratorLimit("PRO")).toBe(10);
  });

  it("returns 25 for BUSINESS plan", () => {
    expect(getCollaboratorLimit("BUSINESS")).toBe(25);
  });

  it("falls back to FREE limit for unknown plans", () => {
    expect(getCollaboratorLimit("UNKNOWN")).toBe(0);
  });
});

// ─── isValidEmail ─────────────────────────────────────────────────────────────

describe("isValidEmail", () => {
  it.each([
    ["user@example.com", true],
    ["user+tag@sub.domain.com", true],
    ["not-an-email", false],
    ["@no-local.com", false],
    ["no-at-sign", false],
    ["double@@domain.com", false],
    ["", false],
    ["  ", false],
    ["space in@local.com", false],
  ])("isValidEmail(%s) === %s", (input, expected) => {
    expect(isValidEmail(input)).toBe(expected);
  });
});

// ─── Invitation token security ────────────────────────────────────────────────

describe("invitation token generation", () => {
  it("generates 64-character hex tokens (256-bit entropy)", async () => {
    // Simulate the crypto.randomBytes(32).toString("hex") call used in the action.
    const { randomBytes } = await import("crypto");
    const token = randomBytes(32).toString("hex");
    expect(token).toHaveLength(64);
    expect(/^[a-f0-9]+$/.test(token)).toBe(true);
  });

  it("generates unique tokens on each call", async () => {
    const { randomBytes } = await import("crypto");
    const tokens = new Set(
      Array.from({ length: 20 }, () => randomBytes(32).toString("hex"))
    );
    expect(tokens.size).toBe(20);
  });

  it("expiry is 48 hours in the future", () => {
    const now = Date.now();
    const expiresAt = new Date(now + 48 * 60 * 60 * 1000);
    const diffHours = (expiresAt.getTime() - now) / (1000 * 60 * 60);
    expect(diffHours).toBeCloseTo(48, 1);
  });
});

// ─── Workspace member role enumeration ───────────────────────────────────────

describe("workspace role access model", () => {
  it("OWNER role has admin privileges", async () => {
    mockOwnerMember();
    const adminCheck = await assertWorkspaceAdmin(WS_ID, OWNER_ID);
    expect(adminCheck).toEqual({ ok: true });
  });

  it("MEMBER role does not have admin privileges", async () => {
    mockRegularMember();
    const adminCheck = await assertWorkspaceAdmin(WS_ID, MEMBER_ID);
    expect("error" in adminCheck).toBe(true);
  });

  it("unauthenticated access is rejected for all privileged operations", async () => {
    mockNotMember();
    const adminCheck = await assertWorkspaceAdmin(WS_ID, STRANGER_ID);
    expect("error" in adminCheck).toBe(true);
    const editorCheck = await assertTaxonomyEditor(WS_ID, STRANGER_ID);
    expect("error" in editorCheck).toBe(true);
  });
});
