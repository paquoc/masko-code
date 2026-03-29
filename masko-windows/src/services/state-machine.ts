import { createSignal } from "solid-js";
import type {
  MaskoAnimationConfig,
  MaskoAnimationEdge,
  MaskoAnimationCondition,
} from "../models/mascot-config";
import {
  type ConditionValue,
  conditionBool,
  conditionNumber,
  conditionToDouble,
  conditionEqual,
} from "../models/types";
import { log, warn } from "./log";

export type StateMachinePhase = "idle" | "looping" | "transitioning";

const AGENT_PREFIX = "agent::";
const LEGACY_PREFIX = "claudeCode::";
const AGENT_STATE_INPUTS = new Set([
  "isWorking",
  "isIdle",
  "isAlert",
  "isCompacting",
  "sessionCount",
]);

export class OverlayStateMachine {
  private config: MaskoAnimationConfig;
  private inputs = new Map<string, ConditionValue>();
  private pendingEdge?: MaskoAnimationEdge;
  private pendingTarget?: string;
  private anyStateEdges: MaskoAnimationEdge[];
  private loopCount = 0;
  private nodeArrivalTime?: Date;
  private nodeTimeGeneration = 0;
  private started = false;

  // Reactive signals for UI
  private _phase = createSignal<StateMachinePhase>("idle");
  private _currentNodeId: ReturnType<typeof createSignal<string>>;
  private _currentVideoUrl = createSignal<string | null>(null);
  private _isLoopVideo = createSignal(true);
  private _playbackRate = createSignal(1.0);

  get phase() { return this._phase[0](); }
  get currentNodeId() { return this._currentNodeId[0](); }
  get currentVideoUrl() { return this._currentVideoUrl[0](); }
  get isLoopVideo() { return this._isLoopVideo[0](); }
  get playbackRate() { return this._playbackRate[0](); }

  get currentNodeName(): string {
    const node = this.config.nodes.find((n) => n.id === this.currentNodeId);
    return node?.name ?? this.currentNodeId;
  }

  constructor(config: MaskoAnimationConfig) {
    this.config = config;
    this._currentNodeId = createSignal(config.initialNode);
    this.anyStateEdges = config.edges
      .filter((e) => e.source === "*")
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.initializeInputs();
  }

  private initializeInputs(): void {
    this.inputs.set("clicked", conditionBool(false));
    this.inputs.set("mouseOver", conditionBool(false));
    this.inputs.set("loopCount", conditionNumber(0));
    this.inputs.set("nodeTime", conditionNumber(0));

    this.setAgentStateInput("isWorking", conditionBool(false));
    this.setAgentStateInput("isIdle", conditionBool(true));
    this.setAgentStateInput("isAlert", conditionBool(false));
    this.setAgentStateInput("isCompacting", conditionBool(false));
    this.setAgentStateInput("sessionCount", conditionNumber(0));

    if (this.config.inputs) {
      for (const input of this.config.inputs) {
        this.inputs.set(input.name, input.default);
      }
    }
  }

  setAgentStateInput(name: string, value: ConditionValue): void {
    // Dedupe: skip if value unchanged (prevents redundant evaluations)
    const old = this.inputs.get(LEGACY_PREFIX + name);
    if (old && conditionEqual(old, value)) return;

    this.inputs.set(AGENT_PREFIX + name, value);
    this.inputs.set(LEGACY_PREFIX + name, value);
    // Trigger evaluation only after start() has been called
    if (this.started) {
      this.evaluateAndFire(LEGACY_PREFIX + name);
    }
  }

  /** Batch multiple agent state inputs — evaluates only once at the end */
  setAgentStateInputs(entries: Array<[string, ConditionValue]>): void {
    let anyChanged = false;
    let lastChanged: string | undefined;
    for (const [name, value] of entries) {
      const old = this.inputs.get(LEGACY_PREFIX + name);
      if (old && conditionEqual(old, value)) continue;
      this.inputs.set(AGENT_PREFIX + name, value);
      this.inputs.set(LEGACY_PREFIX + name, value);
      anyChanged = true;
      lastChanged = LEGACY_PREFIX + name;
    }
    if (anyChanged && this.started && lastChanged) {
      this.evaluateAndFire(lastChanged);
    }
  }

  setAgentEventTrigger(eventName: string): void {
    this.setInput(AGENT_PREFIX + eventName, conditionBool(true));
    this.inputs.set(LEGACY_PREFIX + eventName, conditionBool(true));
  }

  start(): void {
    this.started = true;
    log(
      `State machine starting — initial node: ${this.currentNodeName}`,
    );
    // Log agent inputs at start
    const agentInputs: Record<string, any> = {};
    for (const [k, v] of this.inputs.entries()) {
      if (k.startsWith("agent::") || k.startsWith("claudeCode::")) {
        agentInputs[k] = v;
      }
    }
    log("Inputs at start:", JSON.stringify(agentInputs));
    this.arriveAtNode(this.config.initialNode);
  }

  setInput(name: string, value: ConditionValue): void {
    const old = this.inputs.get(name);
    if (old && conditionEqual(old, value)) return;

    log(`Input changed: ${name} = ${JSON.stringify(value)}${old ? ` (was ${JSON.stringify(old)})` : ""}`);
    this.inputs.set(name, value);
    this.evaluateAndFire(name);
  }

  handleClick(): void {
    this.setInput("clicked", conditionBool(true));
  }

  handleMouseOver(isOver: boolean): void {
    this.setInput("mouseOver", conditionBool(isOver));
  }

  handleLoopCycleCompleted(): void {
    if (this.phase !== "looping") return;
    this.loopCount++;
    this.setInput("loopCount", conditionNumber(this.loopCount));
  }

  handleVideoEnded(): void {
    if (this.phase !== "transitioning" || !this.pendingEdge) return;
    const edge = this.pendingEdge;
    this.pendingEdge = undefined;
    this.arriveAtNode(edge.target);
  }

  // --- Condition Evaluation ---

  private evaluateAndFire(changedInput: string): void {
    const phase = this.phase;

    if (phase !== "looping" && phase !== "idle") {
      // During transitions: only update pendingTarget
      if (phase === "transitioning" && this.anyStateEdges.length > 0) {
        const best = this.findBestAnyStateMatch();
        if (best && best.target !== this.currentNodeId) {
          this.pendingTarget = best.target;
        }
      }
      return;
    }

    // Refresh nodeTime lazily
    if (changedInput !== "nodeTime" && this.nodeArrivalTime) {
      const hasNodeTimeEdge = this.config.edges.some(
        (e) =>
          e.source === this.currentNodeId &&
          !e.isLoop &&
          e.conditions?.some((c) => c.input === "nodeTime"),
      );
      if (hasNodeTimeEdge) {
        const elapsed = Date.now() - this.nodeArrivalTime.getTime();
        this.inputs.set("nodeTime", conditionNumber(elapsed));
      }
    }

    // Step 1: Any State match
    let bestAnyState = this.findBestAnyStateMatch();
    if (bestAnyState?.target === this.currentNodeId) {
      bestAnyState = undefined;
    }

    // Step 2: Preempt or clear pendingTarget
    if (this.pendingTarget) {
      if (bestAnyState && bestAnyState.target !== this.pendingTarget) {
        this.pendingTarget = bestAnyState.target;
      } else if (!bestAnyState) {
        this.pendingTarget = undefined;
      }
    }

    // Step 3: Route toward pendingTarget
    if (this.pendingTarget) {
      const direct = this.findEdgeWithVideo(this.currentNodeId, this.pendingTarget);
      if (direct) {
        this.pendingTarget = undefined;
        this.resetTriggerInput(changedInput);
        this.playTransition(direct);
        return;
      }
      const returnEdge = this.config.edges.find(
        (e) => e.source === this.currentNodeId && !e.isLoop && this.getVideoUrl(e),
      );
      if (returnEdge) {
        this.resetTriggerInput(changedInput);
        this.playTransition(returnEdge);
        return;
      }
      this.pendingTarget = undefined;
    }

    // Step 4: Fire new Any State match
    if (bestAnyState && !this.pendingTarget) {
      const direct = this.findEdgeWithVideo(this.currentNodeId, bestAnyState.target);
      if (direct) {
        this.resetTriggerInput(changedInput);
        this.playTransition(direct);
        return;
      }
      this.pendingTarget = bestAnyState.target;
      const returnEdge = this.config.edges.find(
        (e) => e.source === this.currentNodeId && !e.isLoop && this.getVideoUrl(e),
      );
      if (returnEdge) {
        this.resetTriggerInput(changedInput);
        this.playTransition(returnEdge);
        return;
      }
      this.pendingTarget = undefined;
    }

    // Step 5: Normal evaluation
    const isNodeArrival = changedInput === "nodeArrival";
    for (const edge of this.config.edges) {
      if (edge.source !== this.currentNodeId || edge.isLoop) continue;
      if (this.evaluateConditions(edge.conditions, isNodeArrival)) {
        this.resetTriggerInput(changedInput);
        this.playTransition(edge);
        return;
      }
    }
  }

  private findBestAnyStateMatch(): MaskoAnimationEdge | undefined {
    return this.anyStateEdges.find((e) => this.evaluateConditions(e.conditions));
  }

  private findEdgeWithVideo(
    source: string,
    target: string,
  ): MaskoAnimationEdge | undefined {
    return this.config.edges.find(
      (e) => e.source === source && e.target === target && !e.isLoop && this.getVideoUrl(e),
    );
  }

  private evaluateConditions(conditions?: MaskoAnimationCondition[], debug = false): boolean {
    if (!conditions || conditions.length === 0) return false;
    return conditions.every((c) => {
      const inputValue = this.inputs.get(c.input);
      if (!inputValue) {
        if (debug) log(`condition fail: ${c.input} not found`);
        return false;
      }
      const result = this.compare(inputValue, c.op, c.value);
      if (debug) log(`condition: ${c.input} ${JSON.stringify(inputValue)} ${c.op} ${JSON.stringify(c.value)} = ${result}`);
      return result;
    });
  }

  private compare(lhs: ConditionValue, op: string, rhs: ConditionValue): boolean {
    const left = conditionToDouble(lhs);
    const right = conditionToDouble(rhs);
    switch (op) {
      case "==": return left === right;
      case "!=": return left !== right;
      case ">": return left > right;
      case "<": return left < right;
      case ">=": return left >= right;
      case "<=": return left <= right;
      default: return false;
    }
  }

  private resetTriggerInput(name: string): void {
    if (name === "clicked") {
      this.inputs.set("clicked", conditionBool(false));
    }
    for (const prefix of [AGENT_PREFIX, LEGACY_PREFIX]) {
      if (name.startsWith(prefix)) {
        const suffix = name.slice(prefix.length);
        if (!AGENT_STATE_INPUTS.has(suffix)) {
          this.inputs.set(AGENT_PREFIX + suffix, conditionBool(false));
          this.inputs.set(LEGACY_PREFIX + suffix, conditionBool(false));
        }
        break;
      }
    }
    if (this.config.inputs) {
      const def = this.config.inputs.find((i) => i.name === name);
      if (def?.type === "trigger") {
        this.inputs.set(name, conditionBool(false));
      }
    }
  }

  // --- Node Arrival ---

  private arriveAtNode(nodeId: string): void {
    const prevNodeId = this.currentNodeId;
    const prevName = this.currentNodeName;
    this.nodeTimeGeneration++;
    this.loopCount = 0;
    this._currentNodeId[1](nodeId);

    const newName = this.currentNodeName;
    if (prevNodeId !== nodeId) {
      log(`State: ${prevName} → ${newName}`);
    } else {
      log(`Arrived at: ${newName}`);
    }

    this.inputs.set("loopCount", conditionNumber(0));
    this.inputs.set("nodeTime", conditionNumber(0));
    this.inputs.set("clicked", conditionBool(false));

    const loopEdge = this.config.edges.find(
      (e) => e.source === nodeId && e.target === nodeId && e.isLoop,
    );

    const videoUrl = loopEdge ? this.getVideoUrl(loopEdge) : null;

    if (videoUrl) {
      this._currentVideoUrl[1](videoUrl);
      this._playbackRate[1](loopEdge!.speed ?? 1.0);
      this._isLoopVideo[1](true);
      this._phase[1]("looping");
    } else {
      this._phase[1]("idle");
    }

    this.nodeArrivalTime = new Date();
    this.startNodeTimeTimer();
    this.evaluateAndFire("nodeArrival");
  }

  // --- nodeTime Timer ---

  private startNodeTimeTimer(): void {
    const generation = this.nodeTimeGeneration;

    const thresholds = this.config.edges
      .filter(
        (e) =>
          e.source === this.currentNodeId &&
          !e.isLoop &&
          e.conditions?.some((c) => c.input === "nodeTime"),
      )
      .flatMap((e) =>
        (e.conditions || [])
          .filter((c) => c.input === "nodeTime")
          .map((c) => conditionToDouble(c.value)),
      );

    const unique = [...new Set(thresholds)].sort((a, b) => a - b);

    for (const threshold of unique) {
      setTimeout(() => {
        if (this.nodeTimeGeneration !== generation || !this.nodeArrivalTime) return;
        const elapsed = Date.now() - this.nodeArrivalTime.getTime();
        this.setInput("nodeTime", conditionNumber(elapsed));
      }, threshold);
    }
  }

  // --- Transition Playback ---

  private transitionTimeout?: ReturnType<typeof setTimeout>;

  private playTransition(edge: MaskoAnimationEdge): void {
    if (this.phase !== "looping" && this.phase !== "idle") return;

    const targetNode = this.config.nodes.find((n) => n.id === edge.target);
    const targetName = targetNode?.name ?? edge.target;
    log(
      `Transition: ${this.currentNodeName} → ${targetName}` +
      (edge.conditions?.length ? ` [${edge.conditions.map((c) => `${c.input} ${c.op} ${JSON.stringify(c.value)}`).join(", ")}]` : ""),
    );

    const videoUrl = this.getVideoUrl(edge);
    if (!videoUrl) {
      log(`No video for transition — jumping directly`);
      this.arriveAtNode(edge.target);
      return;
    }

    this.nodeTimeGeneration++;
    if (this.transitionTimeout) clearTimeout(this.transitionTimeout);
    this.pendingEdge = edge;
    this._currentVideoUrl[1](videoUrl);
    this._playbackRate[1](edge.speed ?? 1.0);
    this._isLoopVideo[1](false);
    this._phase[1]("transitioning");

    // Fallback: if video ended event never fires (network error, codec issue),
    // force arrival after duration + 2s
    const timeoutMs = (edge.duration || 4) * 1000 + 2000;
    const gen = this.nodeTimeGeneration;
    this.transitionTimeout = setTimeout(() => {
      if (this.nodeTimeGeneration === gen && this.phase === "transitioning" && this.pendingEdge === edge) {
        warn(`Transition timeout — forcing arrival at ${edge.target}`);
        this.pendingEdge = undefined;
        this.arriveAtNode(edge.target);
      }
    }, timeoutMs);
  }

  /** Get video URL — prefer webm for Windows, fallback to hevc */
  private getVideoUrl(edge: MaskoAnimationEdge): string | null {
    return edge.videos.webm || edge.videos.hevc || null;
  }
}
