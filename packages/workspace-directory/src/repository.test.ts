import {describe, expect, it} from "vitest";
import {DirectoryError} from "./errors.js";
import type {WorkspaceDirectoryRepository} from "./repository.js";

describe("directory repository port", () => {
  it("exposes DirectoryError codes", () => {
    const err = new DirectoryError("DIRECTORY_REVISION_CONFLICT", "stale");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("DIRECTORY_REVISION_CONFLICT");
    expect(err.name).toBe("DirectoryError");
  });

  it("types WorkspaceDirectoryRepository withTransaction", () => {
    const _typeCheck: WorkspaceDirectoryRepository = {
      withTransaction: (fn) => fn({} as never),
    };
    expect(typeof _typeCheck.withTransaction).toBe("function");
  });
});
