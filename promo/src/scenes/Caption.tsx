import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";

// Glass caption pinned bottom-left over footage.
export const Caption: React.FC<{ title: string; sub?: string; color?: string; tag?: string }> = ({ title, sub, color, tag }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - 6, fps, config: { damping: 200 } });
  return (
    <div style={{ position: "absolute", left: 96, bottom: 92, transform: `translateY(${(1 - enter) * 40}px)`, opacity: enter, fontFamily: FONT }}>
      <div style={{ display: "inline-flex", flexDirection: "column", gap: 10, padding: "26px 36px 28px", borderRadius: 28, background: "rgba(255,255,255,.82)", backdropFilter: "blur(18px)", boxShadow: "0 24px 60px rgba(20,28,44,.16)", border: "1px solid rgba(255,255,255,.9)" }}>
        {tag ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 26, fontWeight: 700, color: color ?? C.ink, letterSpacing: ".04em" }}>
            <span style={{ width: 16, height: 16, borderRadius: 8, background: color ?? C.ink, boxShadow: `0 0 0 6px ${(color ?? C.ink)}33` }} />
            {tag}
          </div>
        ) : null}
        <div style={{ fontSize: 58, fontWeight: 800, color: C.ink, letterSpacing: ".01em" }}>{title}</div>
        {sub ? <div style={{ fontSize: 28, color: C.muted, fontWeight: 500, opacity: interpolate(frame, [14, 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>{sub}</div> : null}
      </div>
    </div>
  );
};
