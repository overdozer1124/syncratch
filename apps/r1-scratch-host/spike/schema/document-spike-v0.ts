/**
 * Provisional Task 0 document shape (pre–project-schema Task 1).
 * Mirrors Design §6.1 + §6.4 preserve fields.
 */

export interface CostumeRefSpikeV0 {
  kind: "costume";
  name: string;
  assetId: string;
  md5ext: string;
  dataFormat: string;
  contentSha256: string;
  rotationCenterX: number;
  rotationCenterY: number;
  bitmapResolution?: number;
}

export interface SoundRefSpikeV0 {
  kind: "sound";
  name: string;
  assetId: string;
  md5ext: string;
  dataFormat: string;
  contentSha256: string;
  rate: number;
  sampleCount: number;
  format: string;
}

export interface ScratchBlockSpikeV0 {
  opcode: string;
  next: string | null;
  parent: string | null;
  inputs: Record<string, unknown>;
  fields: Record<string, unknown>;
  shadow?: boolean;
  topLevel?: boolean;
  x?: number;
  y?: number;
  mutation?: Record<string, unknown>;
}

export interface ScratchTargetSpikeV0 {
  name: string;
  isStage: boolean;
  blocks: Record<string, ScratchBlockSpikeV0>;
  variables?: Record<string, [string, string | number] | [string, string | number, boolean]>;
  lists?: Record<string, [string, unknown[]]>;
  broadcasts?: Record<string, string>;
  currentCostume: number;
  costumes: CostumeRefSpikeV0[];
  sounds: SoundRefSpikeV0[];
  volume: number;
  layerOrder: number;
  tempo?: number;
  videoTransparency?: number;
  videoState?: string;
  textToSpeechLanguage?: string | null;
  visible?: boolean;
  x?: number;
  y?: number;
  size?: number;
  direction?: number;
  draggable?: boolean;
  rotationStyle?: string;
}

export interface DocumentSpikeV0 {
  schemaVersion: 0;
  targets: ScratchTargetSpikeV0[];
  extensions: string[];
  meta?: Record<string, unknown>;
}
