import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";
import { Dots } from "./Intro";

const items: [string, string, string][] = [
  ["只在本机", "服务只监听 127.0.0.1，校验 Host 头", C.working],
  ["不看对话", "只返回标题、项目、模型、token 和状态", C.done],
  ["令牌保护", "接口需要令牌，只交给 magpie 页面", C.waiting],
  ["零依赖", "Node 18+，three.js 本地打包，不走 CDN", C.gemini],
];

export const Features: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <Dots />
      <AbsoluteFill style={{ padding: "120px 150px", gap: 60 }}>
        <div style={{ fontSize: 76, fontWeight: 900, color: C.ink }}>读日志，不碰你的数据</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 34 }}>
          {items.map(([t, d, color], i) => {
            const s = spring({ frame: frame - 8 - i * 6, fps, config: { damping: 200 } });
            return (
              <div key={t} style={{ background: "#fff", borderRadius: 30, padding: "40px 44px", boxShadow: "0 18px 50px rgba(20,28,44,.08)", opacity: s, transform: `translateY(${(1 - s) * 40}px)`, borderTop: `8px solid ${color}` }}>
                <div style={{ fontSize: 50, fontWeight: 800, color: C.ink }}>{t}</div>
                <div style={{ fontSize: 30, color: C.muted, marginTop: 14 }}>{d}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
