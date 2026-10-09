import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Summora — Tóm tắt tài liệu bằng AI",
  description: "Không gian tóm tắt tài liệu bằng AI của bạn.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
