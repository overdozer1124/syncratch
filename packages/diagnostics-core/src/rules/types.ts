import type {DiagnosticFinding} from "../contracts.js";
import type {DiagnosticProjectIR} from "../ir.js";

export interface DiagnosticRule {
  id: string;
  run(ir: DiagnosticProjectIR): DiagnosticFinding[];
}

export interface DiagnosticRunOptions {
  /** Include validateProject integrity findings. Default true. */
  includeSchemaFindings?: boolean;
  /** Optional validateProject options when schema findings are enabled. */
  validateOptions?: import("@blocksync/project-schema").ValidateOptions;
}
