import {describe, expect, it} from "vitest";
import {shouldLeaveCollaborationOnGoogleDisconnect} from "./google-disconnect-policy.js";

describe("shouldLeaveCollaborationOnGoogleDisconnect", () => {
  it("keeps the collaboration room when Google Drive disconnects", () => {
    expect(shouldLeaveCollaborationOnGoogleDisconnect()).toBe(false);
  });
});
