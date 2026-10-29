import { AbsoluteFill, Img, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 10, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <OffthreadVideo src={staticFile("footage/outro.mp4")} muted />
      <AbsoluteFill style={{ background: "linear-gradient(90deg, rgba(244,242,238,.96) 0%, rgba(244,242,238,.86) 42%, rgba(244,242,238,0) 75%)" }} />
      <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 140, gap: 30, opacity: s, transform: `translateX(${(1 - s) * -50}px)` }}>
        <Img src={staticFile("xiaoque_avatar.webp")} style={{ width: 150, height: 150, borderRadius: 75, boxShadow: `0 0 0 8px #fff, 0 0 0 13px ${C.claude}` }} />
        <div style={{ fontSize: 104, fontWeight: 900, color: C.ink }}>Agent 办公室</div>
        <div style={{ fontSize: 36, color: C.muted }}>magpie 页面插件 · 开源 · MIT</div>
        <div style={{ fontSize: 40, fontWeight: 700, color: C.ink, background: "#fff", borderRadius: 18, padding: "18px 28px", alignSelf: "flex-start", fontFamily: "Menlo, monospace", boxShadow: "0 14px 40px rgba(0,0,0,.08)" }}>github.com/lst016/magpie-agent-office</div>
        <div style={{ fontSize: 22, color: C.muted, marginTop: 10 }}>小鹊形象源自 yetone/magpie（MIT） · 3D 模型经 GPT 生图与 Tripo 制作</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
