import {describe, expect, it, vi} from "vitest";
import {loadRecordSafely} from "./load-record.js";

describe("loadRecordSafely", () => {
  it("rolls the VM back and preserves committed state when candidate loading fails", async () => {
    const committed = {id: "current"};
    const candidate = {id: "candidate"};
    const load = vi.fn(async (record: {id: string}) => {
      if (record === candidate) throw new Error("load failed");
    });
    const commit = vi.fn();
    const suppression: boolean[] = [];

    await expect(
      loadRecordSafely({
        candidate,
        previous: committed,
        load,
        commit,
        setSuppressed: value => suppression.push(value),
      }),
    ).rejects.toThrow("load failed");

    expect(load).toHaveBeenNthCalledWith(1, candidate);
    expect(load).toHaveBeenNthCalledWith(2, committed);
    expect(commit).not.toHaveBeenCalled();
    expect(suppression).toEqual([true, false]);
  });
});
