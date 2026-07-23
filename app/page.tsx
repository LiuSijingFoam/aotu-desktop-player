import type { Metadata } from "next";
import { PlayerApp } from "./features/player/PlayerApp";

export const metadata: Metadata = {
  title: "凹凸宇宙 · 桌面收听",
  description: "使用自己的凹凸宇宙会员账号，在电脑上浏览并收听节目。",
};

export default function Home() {
  return <PlayerApp />;
}
