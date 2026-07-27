/** Serializable value captured at primitive execution time. */
export type TraceValue =
  | string
  | number
  | boolean
  | null
  | {id?: string; name: string};

export type TraceStateSnapshot = {
  x?: number;
  y?: number;
  direction?: number;
  variable?: {id?: string; name: string; value: TraceValue};
  repeat?: {total: number; loopCounterBefore: unknown};
};

export type TraceSemanticSnapshot = {
  opcode: string | null;
  displayTemplate?: string;
  args: Record<string, TraceValue>;
  before?: TraceStateSnapshot;
  after?: TraceStateSnapshot;
  result?: TraceValue;
  control?: {
    branch?: number;
    iteration?: number;
    total?: number;
    firstVisit?: boolean;
    bounced?: boolean;
    conditionText?: string;
  };
};

export interface TraceEntry {
  blockId: string;
  targetId: string | null;
  /** Frozen at record time so deleted sprites still show a name. */
  targetName: string | null;
  time: number;
  snapshot: TraceSemanticSnapshot;
}

export type TraceBlockUtilLike = {
  thread?: {
    peekStack?: () => string | null;
    target?: TraceTargetLike | null;
  } | null;
  target?: TraceTargetLike | null;
  stackFrame?: Record<string, unknown>;
  sequencer?: {runtime?: TraceRuntimeMetadataLike} | null;
};

export type TraceTargetLike = {
  id?: string;
  getName?: () => string;
  x?: number;
  y?: number;
  direction?: number;
  blocks?: {
    getBlock?: (id: string) => {opcode?: string; fields?: Record<string, {value?: unknown}>} | null;
  };
  lookupVariableById?: (id: string) => {value?: unknown} | null;
  lookupOrCreateVariable?: (
    id: string,
    name: string,
  ) => {value?: unknown};
};

export type TraceRuntimeMetadataLike = {
  getBlocksJSON?: () => Array<{
    type?: string;
    message0?: string;
    message1?: string;
    message2?: string;
  }>;
};

export type TraceDescriptorContext = {
  foreverVisits: WeakMap<object, Map<string, number>>;
};

export type TraceDescriptor = {
  captureBefore?: (
    args: Record<string, unknown>,
    util: TraceBlockUtilLike,
    ctx: TraceDescriptorContext,
  ) => TraceStateSnapshot | undefined;
  captureAfter?: (
    args: Record<string, unknown>,
    util: TraceBlockUtilLike,
    before: TraceStateSnapshot | undefined,
    result: unknown,
    ctx: TraceDescriptorContext,
  ) => TraceStateSnapshot | undefined;
  enrichControl?: (
    args: Record<string, unknown>,
    util: TraceBlockUtilLike,
    before: TraceStateSnapshot | undefined,
    ctx: TraceDescriptorContext,
  ) => TraceSemanticSnapshot["control"];
  describe: (snapshot: TraceSemanticSnapshot) => string;
};
