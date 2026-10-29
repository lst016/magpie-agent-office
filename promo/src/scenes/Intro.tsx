import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";

const Dots: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.paper, backgroundImage: "radial-gradient(rgba(29,35,48,.09) 1.6px, transparent 1.6px)", backgroundSize: "34px 34px" }}>
    <AbsoluteFill style={{ background: "radial-gradient(circle at 30% 20%, rgba(227,135,95,.18), transparent 45%), radial-gradient(circle at 80% 85%, rgba(143,163,201,.22), transparent 50%)" }} />
  </AbsoluteFill>
);
export { Dots };

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, mass: .7 } });
  const t1 = spring({ frame: frame - 12, fps, config: { damping: 200 } });
  const t2 = spring({ frame: frame - 24, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <Dots />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 34 }}>
        <Img src={staticFile("xiaoque_avatar.webp")} style={{ width: 230, height: 230, borderRadius: 115, transform: `scale(${pop})`, boxShadow: `0 0 0 10px #fff, 0 0 0 16px ${C.claude}, 0 30px 70px rgba(0,0,0,.2)` }} />
        <div style={{ fontSize: 120, fontWeight: 900, color: C.ink, letterSpacing: ".02em", opacity: t1, transform: `translateY(${(1 - t1) * 30}px)` }}>Agent 办公室</div>
        <div style={{ fontSize: 38, color: C.muted, fontWeight: 500, opacity: t2, transform: `translateY(${(1 - t2) * 20}px)` }}>
          magpie 插件 · 你的 AI Agent 们，<span style={{ color: C.ink, fontWeight: 700 }}>都在干嘛？</span>
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", bottom: 70, width: "100%", textAlign: "center", fontSize: 24, color: C.muted, opacity: interpolate(frame, [30, 50], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        Claude Code · Codex · Gemini CLI · Grok · Antigravity
      </div>
    </AbsoluteFill>
  );
};
