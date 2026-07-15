import { describe, expect, it } from "vitest";
import * as sessionService from "./index.js";

describe("session-service ports package", () => {
  it("exports port module surface without sqlite coupling", () => {
    expect(sessionService).toBeTruthy();
    expect(Object.keys(sessionService)).toEqual([]);
  });
});
