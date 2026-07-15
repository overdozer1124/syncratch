import { describe, expect, it } from "vitest";
import * as sessionService from "./index.js";

describe("session-service ports package", () => {
  it("exports login surface without sqlite package coupling", () => {
    expect(sessionService.createSessionService).toBeTypeOf("function");
    expect(sessionService.AuthFailedError).toBeTypeOf("function");
    expect(sessionService.createMemoryAuthRepository).toBeTypeOf("function");
  });
});
