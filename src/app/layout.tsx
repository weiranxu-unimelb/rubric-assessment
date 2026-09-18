import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "衡标 · 员工考核", description: "企业员工考核指标与评分系统" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
