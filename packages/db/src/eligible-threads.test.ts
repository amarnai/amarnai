import { describe, it, expect } from "vitest";
import { eligibleThreadWhere } from "./eligible-threads.js";

describe("eligibleThreadWhere", () => {
  const baseSettings = {
    includeSpam: false,
    includePromotions: false,
    blacklistedSenderEmails: [],
  };

  it("always excludes automated and trashed threads", () => {
    const where = eligibleThreadWhere("ws1", baseSettings);
    expect(where.workspaceId).toBe("ws1");
    expect(where.isAutomated).toBe(false);
    expect(where.gmailIsTrash).toBe(false);
  });

  it("excludes spam and promotions by default", () => {
    const where = eligibleThreadWhere("ws1", baseSettings);
    expect(where.gmailIsSpam).toBe(false);
    expect(where.gmailIsPromotions).toBe(false);
  });

  it("includes spam/promotions when opted in", () => {
    const where = eligibleThreadWhere("ws1", {
      ...baseSettings,
      includeSpam: true,
      includePromotions: true,
    });
    expect(where.gmailIsSpam).toBeUndefined();
    expect(where.gmailIsPromotions).toBeUndefined();
  });

  it("adds a blacklisted-sender message filter when the list is non-empty", () => {
    const where = eligibleThreadWhere("ws1", {
      ...baseSettings,
      blacklistedSenderEmails: ["spammer@x.com", "ads@y.com"],
    });
    expect(where.messages).toEqual({
      none: {
        OR: [
          { senderEmail: { equals: "spammer@x.com", mode: "insensitive" } },
          { senderEmail: { equals: "ads@y.com", mode: "insensitive" } },
        ],
      },
    });
  });

  it("omits the message filter when the blacklist is empty", () => {
    const where = eligibleThreadWhere("ws1", baseSettings);
    expect(where.messages).toBeUndefined();
  });

  it("never filters on triageStatus", () => {
    const where = eligibleThreadWhere("ws1", baseSettings) as Record<string, unknown>;
    expect(where["triageStatus"]).toBeUndefined();
  });
});
