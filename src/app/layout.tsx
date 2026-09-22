import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { RuntimeErrorMonitor } from "@/components/runtime-error-monitor";
import { NotificationProvider } from "@/components/app-shell-foundation";
import { APP_METADATA } from "@/lib/app-metadata";

export const metadata: Metadata = {
  title: APP_METADATA.displayName,
  description: APP_METADATA.description,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body><NotificationProvider><RuntimeErrorMonitor /><div className="flex min-h-screen"><Sidebar /><main className="min-w-0 flex-1 p-5 md:p-8">{children}</main></div></NotificationProvider></body></html>;
}
