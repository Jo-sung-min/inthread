import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "insauto — 소셜 자동화 워크스페이스",
  description: "Instagram과 Threads 콘텐츠를 만들고 예약하며 AI와 함께 자동화하는 워크스페이스.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
