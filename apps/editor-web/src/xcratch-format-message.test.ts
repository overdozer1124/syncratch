import {describe, expect, it} from "vitest";
import {
  createXcratchFormatMessage,
  ensureRuntimeFormatMessage,
} from "./xcratch-format-message.js";

describe("xcratch formatMessage shim", () => {
  it("supports setup() and translation merge like Xcratch modules", () => {
    const formatMessage = createXcratchFormatMessage("ja");
    const setup = formatMessage.setup();
    expect(setup.locale).toBe("ja");
    Object.assign(setup.translations.ja, {
      "g2s.name": "AkaDako",
    });
    expect(formatMessage({id: "g2s.name", default: "AkaDako"})).toBe("AkaDako");
    expect(
      formatMessage({id: "missing", defaultMessage: "fallback"}),
    ).toBe("fallback");
  });

  it("attaches formatMessage onto the VM runtime once", () => {
    const runtime: {formatMessage?: ReturnType<typeof createXcratchFormatMessage>} =
      {};
    const first = ensureRuntimeFormatMessage(runtime);
    const second = ensureRuntimeFormatMessage(runtime);
    expect(first).toBe(second);
    expect(typeof runtime.formatMessage?.setup).toBe("function");
  });
});
