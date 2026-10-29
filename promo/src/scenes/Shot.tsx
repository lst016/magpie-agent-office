import { AbsoluteFill, interpolate, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Caption } from "./Caption";

// One footage clip with a slow push and an optional caption.
export const Shot: React.FC<{ clip: string; title?: string; sub?: string; color?: string; tag?: string; trimBefore?: number; focus?: { x: number; y: number; scale: number; from: number } }> = ({ clip, trimBefore, focus, ...cap }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.035]);
  // Optional push toward a point (in 1920x1080 footage pixels).
  const k = focus ? interpolate(frame, [focus.from, focus.from + 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (t) => 1 - (1 - t) ** 3 }) : 0;
  const scale = drift * (1 + ((focus?.scale ?? 1) - 1) * k);
  const origin = focus ? `${focus.x}px ${focus.y}px` : "50% 50%";
  return (
    <AbsoluteFill style={{ background: "#eef0f3" }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: origin }}>
        <OffthreadVideo src={staticFile(`footage/${clip}.mp4`)} trimBefore={trimBefore} muted />
      </AbsoluteFill>
      {cap.title ? <Caption {...(cap as { title: string })} /> : null}
    </AbsoluteFill>
  );
};
