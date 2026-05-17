import { describe, expect, it } from "vitest";
import { APP_NAME } from "./index.js";

describe("shared", () => {
  it("exports APP_NAME", () => {
    expect(APP_NAME).toBe("Genizor");
  });
});
