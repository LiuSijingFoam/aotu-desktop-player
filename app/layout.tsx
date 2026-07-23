import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "凹凸宇宙 · 桌面收听",
    template: "%s · 凹凸宇宙",
  },
  description: "仅供本人使用的凹凸宇宙桌面网页客户端。",
  applicationName: "凹凸宇宙桌面收听",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#171716",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
