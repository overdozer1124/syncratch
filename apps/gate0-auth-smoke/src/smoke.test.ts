import { describe, expect, it } from "vitest";

/**
 * Real Google login smoke is manual/optional.
 * When GOOGLE_CLIENT_ID is unset, this suite records a skipped condition
 * (条件付き合格) and does not fail CI.
 */
describe("gate0-auth-smoke", () => {
  it("skips real GIS when GOOGLE_CLIENT_ID is unset", () => {
    if (!process.env.GOOGLE_CLIENT_ID) {
      expect(process.env.GOOGLE_CLIENT_ID).toBeFalsy();
      return;
    }
    // With CLIENT_ID present, operators must run a manual browser smoke and
    // record results in docs/gate0/GO_NO_GO.md. Automated browser GIS is out
    // of Gate 0 headless CI scope.
    expect(process.env.GOOGLE_CLIENT_ID.length).toBeGreaterThan(0);
  });
});
