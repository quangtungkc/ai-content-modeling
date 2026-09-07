"use client";

import { useEffect, useState } from "react";

type Connection = { id: string; provider: string; maskedKey: string; revokedAt: string | null };
const providers = [{ provider: "OPENAI", kind: "AI", name: "OpenAI" }, { provider: "GEMINI", kind: "AI", name: "Gemini" }, { provider: "VEO", kind: "VIDEO_GENERATION", name: "Veo" }, { provider: "FACEBOOK", kind: "PLATFORM", name: "Facebook" }] as const;
type Provider = (typeof providers)[number];

export function AIConnections() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [selected, setSelected] = useState<Provider>(providers[1]);
  const [message, setMessage] = useState("");
  useEffect(() => { void fetch("/api/v1/ai-connections").then((response) => response.json()).then((body) => setConnections(body.data ?? [])); }, []);
  const connected = (provider: string) => connections.find((item) => item.provider === provider && !item.revokedAt);
  async function save() { const response = await fetch("/api/v1/ai-connections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...selected, apiKey }) }); const body = await response.json(); if (response.ok) { setConnections((current) => [...current.filter((item) => item.provider !== body.data.provider), body.data]); setApiKey(""); setMessage("Đã lưu kết nối an toàn."); } else setMessage(body.error?.message ?? "Không thể lưu kết nối."); }
  async function revoke(id: string) { const response = await fetch(`/api/v1/ai-connections/${id}`, { method: "DELETE" }); if (response.ok) { const body = await response.json(); setConnections((current) => current.map((item) => item.id === id ? body.data : item)); setMessage("Đã ngắt kết nối."); } }
  return <section className="mx-auto max-w-3xl space-y-6"><div><p className="text-sm font-bold text-teal-600">CÀI ĐẶT</p><h2 className="mt-2 text-3xl font-extrabold text-[#0b3262]">Kết nối AI và nền tảng</h2><p className="mt-2 text-sm text-[#6883aa]">API key và token được mã hóa trong database trên máy, không hiển thị đầy đủ.</p></div><div className="space-y-3">{providers.map((item) => { const connection = connected(item.provider); return <div className="flex items-center justify-between rounded-xl border border-[#d8e3f1] bg-white p-4" key={item.provider}><div><p className="font-bold text-[#0b3262]">{item.name}</p><p className="mt-1 text-sm text-[#6883aa]">{connection ? connection.maskedKey : "Chưa kết nối"}</p></div><button className="rounded-lg border border-[#cbd9ea] px-3 py-2 text-sm font-bold text-[#0b5799]" onClick={() => connection ? void revoke(connection.id) : setSelected(item)}>{connection ? "Ngắt kết nối" : "Kết nối"}</button></div>; })}</div><div className="rounded-xl border border-[#d8e3f1] bg-white p-5"><p className="font-bold text-[#0b3262]">Kết nối {selected.name}</p><input aria-label="API key" className="mt-4 w-full rounded-lg border border-[#cbd9ea] px-3 py-2.5 text-[#0b3262]" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={selected.provider === "FACEBOOK" ? "Dán Page Access Token" : "Dán API key"} /><button className="mt-3 rounded-lg bg-[#07865f] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50" disabled={!apiKey} onClick={() => void save()}>Lưu kết nối</button>{message && <p className="mt-3 text-sm text-[#0b5799]">{message}</p>}</div></section>;
}
