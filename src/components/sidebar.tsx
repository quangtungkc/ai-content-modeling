const items = [["▦", "Tổng quan", "/"], ["◉", "My Channels", "/channels"], ["◈", "Daily Reports", "#"], ["▷", "Videos", "#"], ["✦", "Content Projects", "#"], ["▧", "Asset Workspace", "#"], ["⚙", "Settings", "/settings"]];

export function Sidebar() {
  return <aside className="hidden w-[232px] shrink-0 bg-[#0d396d] px-3 py-7 text-white md:flex md:flex-col">
    <div className="px-3"><p className="text-[22px] font-extrabold tracking-wide">MODELING AI</p><p className="mt-1 text-[11px] font-bold tracking-[0.18em] text-teal-300">CONTENT INTELLIGENCE</p></div>
    <div className="my-8 border-t border-white/10" />
    <nav className="space-y-1">{items.map(([icon, label, href], index) => <a href={href} key={label} className={`flex items-center gap-2.5 rounded-lg px-4 py-3 text-sm font-semibold transition ${index === 0 ? "bg-[#205898] text-white shadow-sm" : "text-blue-100 hover:bg-white/10 hover:text-white"}`}><span className="w-4 text-center text-base">{icon}</span>{label}</a>)}</nav>
    <div className="mt-auto px-3 pb-2"><div className="border-t border-white/10 pt-5"><p className="text-sm font-bold">Workspace Phong</p><p className="mt-1 text-xs text-blue-200">AI Content Modeling</p></div></div>
  </aside>;
}
