import catalogJson from "./default-extensions.json" with {type: "json"};

export type ExtensionSource =
  | "scratch-foundation"
  | "stretch3"
  | "xcratch"
  | "turbowarp";

export type ExtensionKind = "builtin" | "hardware" | "external" | "loader";

export type ExtensionOpcodePolicy = "pinned" | "prefix" | "none";

export interface DefaultExtensionEntry {
  /** Scratch / SB3 extension id. Null for UI-only entries (e.g. Extension Loader). */
  extensionId: string | null;
  /** Stable catalog key when extensionId is null. */
  catalogId?: string;
  name: string;
  description: string;
  collaborator: string | null;
  extensionURL: string | null;
  /** Relative or absolute URL for the large gallery card image. */
  iconURL?: string | null;
  /** Relative or absolute URL for the small inset badge image. */
  insetIconURL?: string | null;
  sources: ExtensionSource[];
  kind: ExtensionKind;
  opcodePolicy: ExtensionOpcodePolicy;
}

export interface DefaultExtensionCatalog {
  version: number;
  description: string;
  extensions: DefaultExtensionEntry[];
}

export const defaultExtensionCatalog =
  catalogJson as DefaultExtensionCatalog;

/** Gallery entries that may appear in `project.extensions`. */
export function defaultProjectExtensionIds(): string[] {
  return defaultExtensionCatalog.extensions
    .map((entry) => entry.extensionId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

export function defaultProjectExtensionIdSet(): ReadonlySet<string> {
  return new Set(defaultProjectExtensionIds());
}

/** Extensions whose blocks are accepted by prefix when declared in the project. */
export function prefixOpcodeExtensionIdSet(): ReadonlySet<string> {
  return new Set(
    defaultExtensionCatalog.extensions
      .filter(
        (entry) =>
          entry.opcodePolicy === "prefix" &&
          typeof entry.extensionId === "string" &&
          entry.extensionId.length > 0,
      )
      .map((entry) => entry.extensionId as string),
  );
}

export function findDefaultExtension(
  extensionId: string,
): DefaultExtensionEntry | undefined {
  return defaultExtensionCatalog.extensions.find(
    (entry) => entry.extensionId === extensionId,
  );
}
