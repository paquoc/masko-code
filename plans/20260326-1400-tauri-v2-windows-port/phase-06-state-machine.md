# Phase 06: Animation State Machine

## Context
- Parent: [plan.md](plan.md)
- Dependencies: Phase 02 (models), Phase 05 (video player)
- Reference: `Sources/Services/OverlayStateMachine.swift`

## Overview
- **Date:** 2026-03-26
- **Priority:** Critical
- **Status:** Pending
- **Review:** Not started
- **Description:** Port the JSON-driven animation state machine from Swift to TypeScript. This engine evaluates inputs/conditions and transitions between mascot animation states.

## Key Insights
- State machine has 3 phases: idle, looping (playing loop video), transitioning (playing transition video)
- Inputs are named variables (bool/number): `agent::isWorking`, `clicked`, `nodeTime`, `loopCount`
- Edges have conditions (AND logic): `[{input: "agent::isWorking", op: "==", value: true}]`
- "Any State" edges (source="*") have priority and override normal transitions
- Dual prefix support: `agent::` and `claudeCode::` for backward compatibility
- Trigger inputs auto-reset after firing (vs persistent state inputs)

## Requirements
- Full port of OverlayStateMachine.swift logic
- Condition evaluation: ==, !=, >, <, >=, <=
- Any State edge support with priority sorting
- Pending target routing (intermediate node hops)
- nodeTime timer (scheduled threshold checks)
- Event-driven: setInput() triggers re-evaluation
- Connects to video player (change URL, loop/transition mode)

## Related Code Files

### Create:
- `src/services/state-machine.ts` — Full state machine implementation

### Reference:
- `Sources/Services/OverlayStateMachine.swift` — Complete source (507 lines)

## Implementation Steps

1. Define state machine class:
   ```typescript
   export class OverlayStateMachine {
     private phase: 'idle' | 'looping' | 'transitioning';
     private currentNodeId: string;
     private inputs: Map<string, ConditionValue>;
     private pendingEdge?: MaskoAnimationEdge;
     private pendingTarget?: string;
     private anyStateEdges: MaskoAnimationEdge[];
     // ...
   }
   ```

2. Port `setInput()` — skip if value unchanged, update, evaluate edges

3. Port `evaluateAndFire()`:
   - During transitions: only update pendingTarget
   - Refresh nodeTime lazily when other inputs change
   - Step 1: Find highest-priority Any State match
   - Step 2: Preemption or clear pendingTarget
   - Step 3: Route toward pendingTarget (direct edge or via intermediate)
   - Step 4: Fire new Any State match
   - Step 5: Normal edge evaluation

4. Port `evaluateConditions()` — AND logic, compare function

5. Port `arriveAtNode()` — reset local inputs, find loop edge, start video

6. Port `playTransition()` — set transition video, phase=transitioning

7. Port `resetTriggerInput()` — auto-reset triggers, keep persistent state

8. Port nodeTime timer — use `setTimeout` for each threshold

9. Expose reactive signals for UI:
   ```typescript
   // SolidJS signals exposed to overlay component
   currentVideoUrl: Accessor<string | null>
   isLoopVideo: Accessor<boolean>
   playbackRate: Accessor<number>
   currentNodeName: Accessor<string>
   ```

10. Wire agent events → state machine inputs (in event processor):
    ```typescript
    // SessionStart → isWorking=true, isIdle=false, sessionCount++
    // Stop → isWorking=false, isIdle=true, sessionCount--
    // PermissionRequest → isAlert=true
    // PreCompact → isCompacting=true
    ```

## Todo
- [ ] Define StateMachine class with all properties
- [ ] Port setInput() with change detection
- [ ] Port evaluateAndFire() with 5-step process
- [ ] Port condition evaluation (6 operators)
- [ ] Port Any State edge matching with priority
- [ ] Port pendingTarget routing
- [ ] Port node arrival and video selection
- [ ] Port trigger reset logic
- [ ] Implement nodeTime timer with setTimeout
- [ ] Expose SolidJS reactive signals
- [ ] Wire to event processor
- [ ] Test with clippy.json config

## Success Criteria
- Loading clippy.json: starts at "Idle" node with loop video
- Setting `agent::isWorking=true`: transitions to "Working" node
- Setting `agent::isAlert=true`: transitions to "Needs Attention"
- Click on mascot: fires `clicked=true`, resets after transition
- nodeTime conditions fire at correct thresholds

## Risk Assessment
- **Precision of nodeTime** — JavaScript setTimeout has ~4ms minimum. Should be fine for thresholds in seconds.
- **Dual prefix sync** — Must keep agent:: and claudeCode:: in sync for old mascot configs

## Security Considerations
- None — pure logic, no external I/O

## Next Steps
→ Phase 07: Permission UI
