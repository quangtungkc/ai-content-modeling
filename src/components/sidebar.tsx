"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import packageJson from "../../package.json";

const items = [
  ["▦", "Tổng quan", "/"],
  ["◉", "Kênh của tôi", "/channels"],
  ["◷", "Lịch sử hoạt động", "/activity"],
  ["⚙", "Cài đặt AI", "/settings"],
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const [appVersion, setAppVersion] = useState(packageJson.version);

  useEffect(() => {
    const desktopApp = (window as Window & { desktopApp?: { getVersion: () => Promise<{ version?: string }> } }).desktopApp;
    if (!desktopApp) return;
    void desktopApp.getVersion().then((result) => {
      if (result?.version) setAppVersion(result.version);
    });
  }, []);

  if (pathname === "/login") return null;

  return (
    <aside className="hidden w-[232px] shrink-0 bg-[#0d396d] px-3 py-7 text-white md:flex md:flex-col">
      <div className="px-3"><p className="text-[22px] font-extrabold tracking-wide">MODELING AI</p><p className="mt-1 text-[11px] font-bold tracking-[0.18em] text-teal-300">PHÂN TÍCH NỘI DUNG</p></div>
      <div className="my-8 border-t border-white/10" />
      <nav className="space-y-1">
        {items.map(([icon, label, href]) => <Link href={href} key={label} className={`flex items-center gap-2.5 rounded-lg px-4 py-3 text-sm font-semibold transition-colors ${pathname === href ? "bg-[#205898] text-white shadow-sm" : "text-blue-100 hover:bg-white/10 hover:text-white"}`}><span className="w-4 text-center text-base">{icon}</span>{label}</Link>)}
      </nav>
      <p className="mt-5 px-4 text-xs leading-5 text-blue-200">Báo cáo, video và dự án nội dung sẽ xuất hiện tại đây khi có dữ liệu.</p>
      <div className="mt-auto px-3 pb-2"><div className="border-t border-white/10 pt-5"><p className="text-sm font-bold">Không gian làm việc Phong</p><p className="mt-1 text-xs text-blue-200">AI Content Modeling</p><p className="mt-3 text-xs font-semibold text-teal-300" aria-label="Phiên bản đang sử dụng">Phiên bản đang sử dụng: v{appVersion}</p></div></div>
    </aside>
  );
}
