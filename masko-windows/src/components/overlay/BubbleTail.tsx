/** Directional speech bubble tail — points toward the mascot */
export type TailDir = "down" | "left" | "right";

const SHADOW = "drop-shadow(0 1px 1px rgba(35,17,60,0.08))";

export function BubbleTail(props: { dir: TailDir; color: string }) {
  return (
    <div
      class="flex items-center justify-center shrink-0"
      classList={{
        "pt-0": props.dir === "down",
        "pl-0": props.dir === "right",
        "pr-0": props.dir === "left",
      }}
    >
      <div
        style={{
          width: "0",
          height: "0",
          filter: SHADOW,
          ...(props.dir === "down"
            ? {
                "border-left": "8px solid transparent",
                "border-right": "8px solid transparent",
                "border-top": `8px solid ${props.color}`,
              }
            : props.dir === "left"
              ? {
                  "border-top": "8px solid transparent",
                  "border-bottom": "8px solid transparent",
                  "border-right": `8px solid ${props.color}`,
                }
              : {
                  "border-top": "8px solid transparent",
                  "border-bottom": "8px solid transparent",
                  "border-left": `8px solid ${props.color}`,
                }),
        }}
      />
    </div>
  );
}
