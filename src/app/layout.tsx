import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";

export const metadata: Metadata = {
  title: "AI Content Modeling",
  description: "AI Content Modeling MVP",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body><div className="flex min-h-screen"><Sidebar /><main className="min-w-0 flex-1 p-5 md:p-8">{children}</main></div></body></html>;
}
