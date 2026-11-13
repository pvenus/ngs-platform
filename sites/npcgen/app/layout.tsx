import type { Metadata } from "next";
import "./globals.css";
import {FrontendSessionProvider} from "./frontend-session";
import {StatusConsoleProvider} from './status-console';
import NewRequestHost from "./new-request-modal";

export const metadata: Metadata = {
  title: "NPC Gen · VINUS",
  description: "마스터 컨셉·스토리·NPC·프로젝트 지식의 게시 사본과 변경 요청을 확인하는 작업실.",
  other: {
    "codex-preview": "development",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased"><StatusConsoleProvider><FrontendSessionProvider enabled={process.env.NPCGEN_FRONTEND_ONLY==="1"}><NewRequestHost>{children}</NewRequestHost></FrontendSessionProvider></StatusConsoleProvider></body>
    </html>
  );
}
