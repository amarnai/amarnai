import { describe, expect, it } from "vitest";
import { mapMembers } from "./mapMembers.js";

describe("mapMembers", () => {
  it("maps member rows to MemberItem", () => {
    const members = mapMembers([
      { user: { id: "u1", email: "ana@example.com", name: "Ana" } },
      { user: { id: "u2", email: "bo@example.com", name: null } },
    ]);
    expect(members).toEqual([
      { userId: "u1", name: "Ana", email: "ana@example.com" },
      { userId: "u2", name: null, email: "bo@example.com" },
    ]);
  });

  it("dedupes rows by user id, keeping the first", () => {
    const members = mapMembers([
      { user: { id: "u1", email: "ana@example.com", name: "Ana" } },
      { user: { id: "u1", email: "ana@other.com", name: "Ana B" } },
    ]);
    expect(members).toEqual([{ userId: "u1", name: "Ana", email: "ana@example.com" }]);
  });

  it("returns an empty list for no rows", () => {
    expect(mapMembers([])).toEqual([]);
  });
});
