"use client";

import { FormEvent, useEffect, useState } from "react";

type Channel = {
  id: string; name: string; platform: string; topic: string; subTopic: string;
  targetCountry: string; language: string; audience: string; contentStyle: string;
  visualStyle: string; videoDuration: string; hasDialogue: boolean;
  creativeInstructions: string; timezone: string;
};
type Competitor = { id: string; channelId: string; platform: string; url: string; externalId: string; handle: string; displayName: string; avatar: string; status: "Active" | "Paused"; createdAt: string };

const emptyChannel: Omit<Channel, "id"> = {
  name: "", platform: "TikTok", topic: "", subTopic: "", targetCountry: "",
  language: "", audience: "", contentStyle: "", visualStyle: "",
  videoDuration: "", hasDialogue: false, creativeInstructions: "", timezone: "UTC",
};

const sampleChannels: Channel[] = [
  { id: "funny-animals", name: "Funny Animals", platform: "TikTok", topic: "Comedy", subTopic: "Animal comedy", targetCountry: "US", language: "English", audience: "General audience", contentStyle: "Short-form comedy", visualStyle: "3D stylized comedy", videoDuration: "30", hasDialogue: false, creativeInstructions: "Keep the humor visual and easy to understand.", timezone: "America/New_York" },
  { id: "science-lab", name: "Science Lab", platform: "YouTube", topic: "Education", subTopic: "Popular science", targetCountry: "Germany", language: "German", audience: "Curious learners", contentStyle: "Educational explainers", visualStyle: "Documentary", videoDuration: "180", hasDialogue: true, creativeInstructions: "Explain complex ideas with clear visual examples.", timezone: "Europe/Berlin" },
  { id: "kids-stories", name: "Kids Stories", platform: "TikTok", topic: "Kids", subTopic: "Bedtime stories", targetCountry: "Vietnam", language: "Vietnamese", audience: "Children and parents", contentStyle: "Narrative stories", visualStyle: "2D colorful animation", videoDuration: "60", hasDialogue: true, creativeInstructions: "Use gentle language and positive endings.", timezone: "Asia/Ho_Chi_Minh" },
];

const fields: Array<[keyof Omit<Channel, "id" | "hasDialogue">, string, string]> = [
  ["name", "Channel name", "e.g. Funny Animals"], ["platform", "Platform", "TikTok, YouTube..."],
  ["topic", "Topic", "Comedy, Education..."], ["subTopic", "Sub-topic", "Optional"],
  ["targetCountry", "Target country / market", "e.g. Vietnam"], ["language", "Language", "e.g. Vietnamese"],
  ["audience", "Audience", "Who is this for?"], ["contentStyle", "Content style", "e.g. Short-form comedy"],
  ["visualStyle", "Visual style", "e.g. 3D stylized"], ["videoDuration", "Video duration (seconds)", "e.g. 30"],
  ["timezone", "Timezone", "e.g. Asia/Ho_Chi_Minh"],
];

function toUiChannel(value: Record<string, unknown>): Channel {
  return { id: String(value.id), name: String(value.name ?? ""), platform: String(value.platform ?? ""), topic: String(value.topic ?? ""), subTopic: String(value.subTopic ?? ""), targetCountry: String(value.targetCountry ?? ""), language: String(value.language ?? ""), audience: String(value.audience ?? ""), contentStyle: String(value.contentStyle ?? ""), visualStyle: String(value.visualStyle ?? ""), videoDuration: value.videoDurationSec == null ? "" : String(value.videoDurationSec), hasDialogue: Boolean(value.hasDialogue), creativeInstructions: String(value.creativeInstructions ?? ""), timezone: String(value.timezone ?? "UTC") };
}

function toPayload(channel: Channel) {
  const { id: _id, ...payload } = channel;
  void _id;
  return { ...payload, videoDuration: channel.videoDuration ? Number(channel.videoDuration) : undefined };
}

function toUiCompetitor(value: Record<string, unknown>): Competitor {
  return { id: String(value.id), channelId: String(value.channelId), platform: String(value.platform), url: String(value.url), externalId: String(value.externalId), handle: String(value.handle), displayName: String(value.displayName ?? value.handle), avatar: String(value.avatar ?? ""), status: value.status === "ACTIVE" ? "Active" : "Paused", createdAt: String(value.createdAt) };
}

export function ChannelManager() {
  const [channels, setChannels] = useState(sampleChannels);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Channel | null>(null);
  const [competitorChannel, setCompetitorChannel] = useState<Channel | null>(null);
  const [competitors, setCompetitors] = useState<Record<string, Competitor[]>>({});
  useEffect(() => {
    fetch("/api/v1/channels").then(async (response) => {
      if (!response.ok) throw new Error("Không thể tải Channel từ database.");
      const body = await response.json() as { data: Array<Record<string, unknown>> };
      setChannels(body.data.map(toUiChannel));
    }).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Không thể tải Channel."));
  }, []);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  function openCreate() { setEditing({ id: crypto.randomUUID(), ...emptyChannel }); setIsCreating(true); }
  function openEdit(channel: Channel) { setEditing({ ...channel }); setIsCreating(false); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing?.name.trim()) return;
    try {
      const response = await fetch(isCreating ? "/api/v1/channels" : `/api/v1/channels/${editing.id}`, { method: isCreating ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toPayload(editing)) });
      if (!response.ok) throw new Error("Không thể lưu Channel.");
      const body = await response.json() as { data: Record<string, unknown> };
      const saved = toUiChannel(body.data);
      setChannels((current) => isCreating ? [...current, saved] : current.map((item) => item.id === saved.id ? saved : item));
      setEditing(null); setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Không thể lưu Channel."); }
  }
  async function remove(channel: Channel) {
    if (!window.confirm(`Xóa Channel “${channel.name}”?`)) return;
    try {
      const response = await fetch(`/api/v1/channels/${channel.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Không thể xóa Channel.");
      setChannels((current) => current.filter((item) => item.id !== channel.id)); setNotice("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Không thể xóa Channel."); }
  }

  return <section className="mx-auto max-w-6xl">
    <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="text-sm text-cyan-400">Workspace</p><h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">My Channels</h2><p className="mt-2 text-sm text-slate-400">Mỗi Channel là một workspace độc lập cho content modeling.</p></div><button onClick={openCreate} className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">+ New Channel</button></div>
    {notice && <div className="mt-6 rounded-lg border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">{notice}</div>}
    <div className="mt-8 grid gap-4 lg:grid-cols-3">{channels.map((channel) => <article key={channel.id} className="group rounded-xl border border-white/10 bg-white/[.04] p-5 transition hover:border-cyan-400/40 hover:bg-white/[.07]"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-white">{channel.name}</h3><p className="mt-1 text-sm text-slate-400">{channel.targetCountry} <span className="text-slate-600">•</span> {channel.platform} <span className="text-slate-600">•</span> {channel.topic}</p></div><span className="rounded-full bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-300">Active</span></div><div className="mt-6 flex flex-wrap gap-2 border-t border-white/10 pt-4"><button onClick={() => setSelected(channel)} className="rounded-md px-3 py-2 text-xs text-slate-300 hover:bg-white/10 hover:text-white">View</button><button onClick={() => openEdit(channel)} className="rounded-md px-3 py-2 text-xs text-slate-300 hover:bg-white/10 hover:text-white">Edit</button><button onClick={() => setCompetitorChannel(channel)} className="rounded-md px-3 py-2 text-xs text-cyan-300 hover:bg-cyan-400/10">Competitors ({competitors[channel.id]?.length ?? 0})</button><button onClick={() => remove(channel)} className="ml-auto rounded-md px-3 py-2 text-xs text-rose-300 hover:bg-rose-400/10">Delete</button></div></article>)}{channels.length === 0 && <div className="rounded-xl border border-dashed border-white/15 p-10 text-center text-sm text-slate-400 lg:col-span-3">Chưa có Channel. Tạo Channel đầu tiên để bắt đầu.</div>}</div>
    {editing && <ChannelModal channel={editing} title={isCreating ? "New Channel" : "Edit Channel"} onChange={setEditing} onClose={() => setEditing(null)} onSave={save} />}
    {selected && <ChannelDetails channel={selected} onClose={() => setSelected(null)} onEdit={() => { setSelected(null); openEdit(selected); }} />}
    {competitorChannel && <CompetitorManager channel={competitorChannel} items={competitors[competitorChannel.id] ?? []} onClose={() => setCompetitorChannel(null)} onChange={(items) => setCompetitors((current) => ({ ...current, [competitorChannel.id]: items }))} />}
  </section>;
}

function ChannelModal({ channel, title, onChange, onClose, onSave }: { channel: Channel; title: string; onChange: (channel: Channel) => void; onClose: () => void; onSave: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"><form onSubmit={onSave} className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-widest text-cyan-400">Channel configuration</p><h3 className="mt-1 text-xl font-semibold text-white">{title}</h3></div><button type="button" onClick={onClose} className="text-2xl text-slate-500 hover:text-white" aria-label="Close">×</button></div><div className="mt-6 grid gap-4 sm:grid-cols-2">{fields.map(([key, label, placeholder]) => <label key={key} className="text-sm text-slate-300">{label}<input required={key === "name" || key === "platform" || key === "topic"} value={channel[key]} onChange={(event) => onChange({ ...channel, [key]: event.target.value })} placeholder={placeholder} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400" /></label>)}</div><label className="mt-4 flex items-center gap-3 text-sm text-slate-300"><input type="checkbox" checked={channel.hasDialogue} onChange={(event) => onChange({ ...channel, hasDialogue: event.target.checked })} className="h-4 w-4 accent-cyan-400" /> Has dialogue</label><label className="mt-4 block text-sm text-slate-300">Creative instructions<textarea value={channel.creativeInstructions} onChange={(event) => onChange({ ...channel, creativeInstructions: event.target.value })} rows={3} placeholder="Guidelines the AI should follow..." className="mt-1.5 w-full resize-y rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400" /></label><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm text-slate-300 hover:bg-white/10">Cancel</button><button type="submit" className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300">Save Channel</button></div></form></div>;
}

function ChannelDetails({ channel, onClose, onEdit }: { channel: Channel; onClose: () => void; onEdit: () => void }) {
  const details = [["Target country / market", channel.targetCountry], ["Language", channel.language], ["Audience", channel.audience], ["Content style", channel.contentStyle], ["Visual style", channel.visualStyle], ["Video duration", `${channel.videoDuration || "—"} seconds`], ["Has dialogue", channel.hasDialogue ? "Yes" : "No"], ["Timezone", channel.timezone]];
  return <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"><div className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-widest text-cyan-400">Channel details</p><h3 className="mt-1 text-2xl font-semibold text-white">{channel.name}</h3><p className="mt-1 text-sm text-slate-400">{channel.platform} · {channel.topic}{channel.subTopic ? ` · ${channel.subTopic}` : ""}</p></div><button onClick={onClose} className="text-2xl text-slate-500 hover:text-white" aria-label="Close">×</button></div><dl className="mt-6 grid gap-4 border-t border-white/10 pt-5 sm:grid-cols-2">{details.map(([label, value]) => <div key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-sm text-slate-200">{value}</dd></div>)}</dl><div className="mt-6 rounded-lg bg-white/[.04] p-4"><p className="text-xs text-slate-500">Creative instructions</p><p className="mt-1 text-sm leading-6 text-slate-300">{channel.creativeInstructions || "Chưa có hướng dẫn riêng."}</p></div><div className="mt-6 flex justify-end gap-3"><button onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm text-slate-300 hover:bg-white/10">Close</button><button onClick={onEdit} className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300">Edit Channel</button></div></div></div>;
}

function CompetitorManager({ channel, items, onClose, onChange }: { channel: Channel; items: Competitor[]; onClose: () => void; onChange: (items: Competitor[]) => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/v1/channels/${channel.id}/competitors`).then(async (response) => {
      if (!response.ok) throw new Error("Không thể tải competitor từ database.");
      const body = await response.json() as { data: Array<Record<string, unknown>> };
      onChange(body.data.map(toUiCompetitor));
    }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Không thể tải competitor."));
    // The parent callback is intentionally not a dependency: it is an inline state adapter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);
  async function addCompetitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const response = await fetch(`/api/v1/channels/${channel.id}/competitors`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const body = await response.json() as { data?: Record<string, unknown>; error?: { message?: string } };
      if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể thêm competitor.");
      onChange([...items, toUiCompetitor(body.data)]);
      setUrl(""); setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "URL không hợp lệ."); }
  }
  async function toggle(item: Competitor) {
    const status = item.status === "Active" ? "INACTIVE" : "ACTIVE";
    const response = await fetch(`/api/v1/competitors/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (!response.ok) { setError("Không thể cập nhật trạng thái competitor."); return; }
    onChange(items.map((current) => current.id === item.id ? { ...current, status: status === "ACTIVE" ? "Active" : "Paused" } : current));
  }
  async function remove(item: Competitor) {
    const response = await fetch(`/api/v1/competitors/${item.id}`, { method: "DELETE" });
    if (!response.ok) { setError("Không thể xóa competitor."); return; }
    onChange(items.filter((current) => current.id !== item.id));
  }
  return <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"><div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-widest text-cyan-400">Competitors</p><h3 className="mt-1 text-2xl font-semibold text-white">{channel.name}</h3><p className="mt-1 text-sm text-slate-400">Thêm 10–50 competitor URLs cho Channel này.</p></div><button onClick={onClose} className="text-2xl text-slate-500 hover:text-white" aria-label="Close">×</button></div><form onSubmit={addCompetitor} className="mt-6 flex flex-col gap-3 sm:flex-row"><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://tiktok.com/@... hoặc https://youtube.com/@..." className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400" /><button type="submit" className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300">Add competitor URL</button></form>{error && <p className="mt-2 text-sm text-rose-300">{error}</p>}<div className="mt-6 overflow-hidden rounded-lg border border-white/10"><div className="grid grid-cols-[1fr_auto] gap-4 border-b border-white/10 bg-white/[.04] px-4 py-3 text-xs uppercase tracking-wider text-slate-500"><span>Competitor</span><span>Status</span></div>{items.length === 0 ? <p className="px-4 py-8 text-center text-sm text-slate-500">Chưa có competitor URL.</p> : items.map((item) => <div key={item.id} className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-white/5 px-4 py-4 last:border-0"><div className="min-w-0"><div className="flex items-center gap-2"><span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300">{item.platform}</span><p className="font-medium text-white">{item.displayName}</p></div><p className="mt-1 truncate text-xs text-slate-500">{item.url}</p><p className="mt-1 text-xs text-slate-600">id: {item.id} · channelId: {item.channelId} · externalId: {item.externalId} · handle: {item.handle} · createdAt: {new Date(item.createdAt).toLocaleDateString("vi-VN")}</p></div><div className="flex items-center gap-2"><button onClick={() => toggle(item)} className={`rounded-full px-2.5 py-1 text-[11px] ${item.status === "Active" ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}>{item.status}</button><button onClick={() => remove(item)} className="rounded-md px-2 py-1 text-xs text-rose-300 hover:bg-rose-400/10">Delete</button></div></div>)}</div><div className="mt-5 flex justify-end"><button onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm text-slate-300 hover:bg-white/10">Close</button></div></div></div>;
}
