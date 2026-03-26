import { type ConditionValue, parseConditionValue } from "./types";

export interface MaskoAnimationConfig {
  version: string;
  name: string;
  initialNode: string;
  autoPlay: boolean;
  nodes: MaskoAnimationNode[];
  edges: MaskoAnimationEdge[];
  inputs?: MaskoAnimationInput[];
}

export interface MaskoAnimationNode {
  id: string;
  name: string;
  transparentThumbnailUrl?: string;
}

export interface MaskoAnimationEdge {
  id: string;
  source: string; // node ID, or "*" for Any State edges
  target: string;
  isLoop: boolean;
  duration: number;
  conditions?: MaskoAnimationCondition[];
  videos: MaskoAnimationVideos;
  priority?: number; // Any State edges: higher = checked first
  speed?: number; // Playback rate (defaults to 1.0)
}

export interface MaskoAnimationCondition {
  input: string;
  op: string; // "==", "!=", ">", "<", ">=", "<="
  value: ConditionValue;
}

export interface MaskoAnimationVideos {
  webm?: string;
  hevc?: string;
}

export interface MaskoAnimationInput {
  name: string;
  type: "boolean" | "number" | "trigger";
  default: ConditionValue;
  system?: boolean;
}

/** Parse raw JSON condition into typed MaskoAnimationCondition */
export function parseCondition(raw: any): MaskoAnimationCondition {
  return {
    input: raw.input,
    op: raw.op || "==",
    value: parseConditionValue(raw.value ?? true),
  };
}

/** Parse a raw mascot config JSON, normalizing conditions */
export function parseMascotConfig(raw: any): MaskoAnimationConfig {
  return {
    ...raw,
    edges: (raw.edges || []).map((edge: any) => ({
      ...edge,
      conditions: (edge.conditions || []).map(parseCondition),
    })),
    inputs: (raw.inputs || []).map((input: any) => ({
      ...input,
      default: parseConditionValue(input.default ?? (input.type === "number" ? 0 : false)),
    })),
  };
}

/** Saved mascot in the user's collection */
export interface SavedMascot {
  id: string;
  name: string;
  config: MaskoAnimationConfig;
  templateSlug?: string;
  addedAt: string;
}
