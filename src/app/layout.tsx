import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Market Range Viewer",
  description: "Cross-market chart viewer with flexible historical range controls.",
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
