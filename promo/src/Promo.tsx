import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { C } from "./theme";
import { Features } from "./scenes/Features";
import { Intro } from "./scenes/Intro";
import { Outro } from "./scenes/Outro";
import { Problem } from "./scenes/Problem";
import { Shot } from "./scenes/Shot";

const T = 12;
const cut = <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T })} />;

export const PROMO_FRAMES = 75 + 90 + 180 + 150 + 105 + 105 + 150 + 96 + 120 + 120 + 150 + 150 + 120 + 210 - 13 * T;

export const Promo: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence name="Intro" durationInFrames={75}><Intro /></TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={slide({ direction: "from-right" })} timing={linearTiming({ durationInFrames: T })} />
    <TransitionSeries.Sequence name="Problem" durationInFrames={90}><Problem /></TransitionSeries.Sequence>
    {cut}
    <TransitionSeries.Sequence name="Hero" durationInFrames={180}><Shot clip="hero" title="整间办公室，一眼看清" sub="每个会话都是一个小鹊，实时 3D，每 3 秒刷新" /></TransitionSeries.Sequence>
    {cut}
    <TransitionSeries.Sequence name="Push" durationInFrames={150}><Shot clip="push" title="状态写在动作里" sub="不用切终端，看人就知道" /></TransitionSeries.Sequence>
    {cut}
    <TransitionSeries.Sequence name="Working" durationInFrames={105}><Shot clip="working" tag="进行中" color={C.working} title="坐在工位，对着屏幕打字" /></TransitionSeries.Sequence>
    {cut}
    <TransitionSeries.Sequence name="Waiting" durationInFrames={105}><Shot clip="waiting" tag="等你" color={C.waiting} title="举手招呼，头顶一个「!」" sub="按权限设置和进程推断，长命令不误报" /></TransitionSeries.Sequence>
    {cut}
    <TransitionSeries.Sequence name="DoneAbort" durationInFrames={150}><Shot clip="doneabort" tag="刚完成 / 被中断" color={C.done} title="做完欢呼，中断抱头" /></TransitionSeries.Sequence>
    {cut}
    <TransitionSeries.Sequence name="Stalled" durationInFrames={96}><Shot clip="stalled" tag="没动静" color={C.stalled} title="趴在桌上 zzz" /></TransitionSeries.Sequence>
    {cut}
    <TransitionSeries.Sequence name="Lounge1" durationInFrames={120}><Shot clip="lounge1" tag="空闲" color={C.antigravity} title="跑步机、茶水间" /></TransitionSeries.Sequence>
    {cut}
    <TransitionSeries.Sequence name="Lounge2" durationInFrames={120}><Shot clip="lounge2" tag="空闲" color={C.antigravity} title="沙发歇会，行军床补觉" /></TransitionSeries.Sequence>
    {cut}
    <TransitionSeries.Sequence name="Card" durationInFrames={150}><Shot clip="card" focus={{ x: 1190, y: 700, scale: 1.75, from: 28 }} title="点一下，看资料卡" sub="项目 · 模型 · token · 常用工具，不显示对话内容" /></TransitionSeries.Sequence>
    {cut}
    <TransitionSeries.Sequence name="Dark" durationInFrames={150}><Shot clip="dark" title="跟随 magpie 深色模式" /></TransitionSeries.Sequence>
    {cut}
    <TransitionSeries.Sequence name="Features" durationInFrames={120}><Features /></TransitionSeries.Sequence>
    {cut}
    <TransitionSeries.Sequence name="Outro" durationInFrames={210}><Outro /></TransitionSeries.Sequence>
  </TransitionSeries>
);
