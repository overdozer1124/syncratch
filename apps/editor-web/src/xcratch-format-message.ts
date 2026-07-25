/**
 * Minimal format-message compatible helper for Xcratch / Stretch3 modules.
 *
 * Those modules call `formatMessage.setup()` and optionally merge their own
 * translation tables into `setup().translations[locale]`. Syncratch's VM
 * runtime does not ship format-message, so we attach this before constructing
 * the extension class.
 */

export type FormatMessageDescriptor = {
  id?: string;
  default?: string;
  defaultMessage?: string;
  description?: string;
};

export type FormatMessageSetup = {
  locale: string;
  translations: Record<string, Record<string, string>>;
};

export type XcratchFormatMessage = ((
  message: FormatMessageDescriptor | string,
  ...args: unknown[]
) => string) & {
  setup: (options?: Partial<FormatMessageSetup>) => FormatMessageSetup;
};

export function createXcratchFormatMessage(
  locale = "ja",
): XcratchFormatMessage {
  const state: FormatMessageSetup = {
    locale,
    translations: {[locale]: {}},
  };

  const formatMessage = ((
    message: FormatMessageDescriptor | string,
  ): string => {
    if (typeof message === "string") return message;
    const id = message.id;
    const table = state.translations[state.locale];
    if (id && table && typeof table[id] === "string") {
      return table[id];
    }
    return message.defaultMessage ?? message.default ?? id ?? "";
  }) as XcratchFormatMessage;

  formatMessage.setup = (options?: Partial<FormatMessageSetup>) => {
    if (options?.locale) state.locale = options.locale;
    if (options?.translations) {
      for (const [loc, messages] of Object.entries(options.translations)) {
        state.translations[loc] = {
          ...(state.translations[loc] ?? {}),
          ...messages,
        };
      }
    }
    if (!state.translations[state.locale]) {
      state.translations[state.locale] = {};
    }
    return state;
  };

  return formatMessage;
}

export function ensureRuntimeFormatMessage(
  runtime: unknown,
  locale = "ja",
): XcratchFormatMessage {
  if (!runtime || typeof runtime !== "object") {
    throw new Error("拡張機能の runtime がありません");
  }
  const rt = runtime as {formatMessage?: XcratchFormatMessage};
  const existing = rt.formatMessage;
  if (
    typeof existing === "function" &&
    typeof existing.setup === "function"
  ) {
    return existing;
  }
  const formatMessage = createXcratchFormatMessage(locale);
  rt.formatMessage = formatMessage;
  return formatMessage;
}
