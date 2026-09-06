"use client";

import { useEffect, useState } from "react";

type Connection = { id: string; provider: string; kind: string; label: string | null; maskedKey: string; revokedAt: string | null };
const providers = [{ provider: "OPENAI", kind: "AI", name: "OpenAI" }, { provider: "GEMINI", kind: "AI", name: "Gemini" }, { provider: "VEO", kind: "VIDEO_GENERATION", name: "Veo" }];

export function AIConnections() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [selected, setSelected] = useState(providers[1]);
  const [message, setMessage] = useState("");
  useEffect(() => { void fetch("/api/v1/ai-connections").then((response) => response.json()).then((body) => setConnections(body.data ?? [])); }, []);
  const connected = (provider: string) => connections.find((item) => item.provider === provider && !item.revokedAt);
  async function save() { const response = await fetch("/api/v1/ai-connections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...selected, apiKey }) }); const body = await response.json(); if (response.ok) { setConnections((current) => [...current.filter((item) => item.id !== body.data.id && item.provider !== body.data.provider), body.data]); setApiKey(""); setMessage("Đã lưu connection an toàn."); } else setMessage(body.error?.message ?? "Không thể lưu connection."); }
  async function revoke(id: string) { const response = await fetch(`/api/v1/ai-connections/${id}`, { method: "DELETE" }); if (response.ok) { const body = await response.json(); setConnections((current) => current.map((item) => item.id === id ? body.data : item)); setMessage("Đã revoke connection."); } }
  return <section className="max-w-3xl space-y-8"><div><p className="text-sm text-cyan-400">Settings</p><h2 className="mt-2 text-3xl font-semibold text-white">AI Connections</h2><p className="mt-2 text-slate-400">API key được mã hóa ở server và không bao giờ trả về đầy đủ.</p></div><div className="space-y-3">{providers.map((item) => { const connection = connected(item.provider); return <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4" key={item.provider}><div><p className="font-medium text-white">{item.name}</p><p className="mt-1 text-sm text-slate-400">{connection ? connection.maskedKey : "Chưa kết nối"}</p></div><button className="rounded-md border border-white/15 px-3 py-2 text-sm text-slate-200 hover:bg-white/10" onClick={() => connection ? void revoke(connection.id) : setSelected(item)}>{connection ? "Revoke" : "Connect"}</button></div>; })}</div><div className="rounded-xl border border-white/10 bg-slate-900/60 p-5"><p className="font-medium text-white">{selected.name}</p><input aria-label="API key" className="mt-4 w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-white outline-none" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Dán API key" /><button className="mt-3 rounded-md bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400" disabled={!apiKey} onClick={() => void save()}>Lưu connection</button>{message && <p className="mt-3 text-sm text-slate-300">{message}</p>}</div></section>;
}
