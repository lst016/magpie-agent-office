import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";
import { Dots } from "./Intro";

const agents: [string, string][] = [["Claude Code", C.claude], ["Codex", C.codex], ["Gemini", C.gemini], ["Grok", C.grok], ["Antigravity", C.antigravity]];
const asks: [string, string][] = [["谁在干活？", C.working], ["谁在等你批准？", C.waiting], ["谁已经做完了？", C.done]];

export const Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <Dots />
      <AbsoluteFill style={{ padding: "150px 170px", gap: 56 }}>
        <div style={{ fontSize: 44, color: C.muted, fontWeight: 600 }}>同时开着五六个终端……</div>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
          {agents.map(([name, color], i) => {
            const s = spring({ frame: frame - 6 - i * 4, fps, config: { damping: 14 } });
            return <div key={name} style={{ fontSize: 40, fontWeight: 700, padding: "16px 30px", borderRadius: 999, background: "#fff", color: C.ink, border: `3px solid ${color}`, transform: `scale(${s}) rotate(${(i % 2 ? 1 : -1) * (1 - s) * 8}deg)`, boxShadow: "0 10px 30px rgba(0,0,0,.08)" }}>{name}</div>;
          })}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 20 }}>
          {asks.map(([q, color], i) => {
            const s = spring({ frame: frame - 34 - i * 10, fps, config: { damping: 200 } });
            return <div key={q} style={{ fontSize: 92, fontWeight: 900, color: C.ink, opacity: s, transform: `translateX(${(1 - s) * -60}px)` }}><span style={{ color }}>●</span> {q}</div>;
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
