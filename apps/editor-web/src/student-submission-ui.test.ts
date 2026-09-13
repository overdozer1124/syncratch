/** @vitest-environment jsdom */
import {describe, expect, it, vi, beforeEach, afterEach} from "vitest";
import {mountStudentSubmissionUi} from "./student-submission-ui.js";

describe("student submission ui", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {randomUUID: () => "idem-1"});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits exported sb3 via multipart form", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ok: true, submission: {isResubmission: false}}),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const root = document.createElement("div");
    mountStudentSubmissionUi({
      root,
      exportSb3: async () => new Uint8Array([1, 2, 3]),
      getProjectTitle: () => "My project",
      maxBytes: 1024,
    });

    const button = root.querySelector(".student-submission-submit") as HTMLButtonElement;
    button.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBeInstanceOf(FormData);

    vi.unstubAllGlobals();
  });
});
