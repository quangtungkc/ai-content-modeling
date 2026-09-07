"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";

type Channel = {
  id: string;
  name: string;
  platform: string;
  topic: string;
  subTopic: string;
  targetCountry: string;
  language: string;
  audience: string;
  contentStyle: string;
  visualStyle: string;
  videoDuration: string;
  hasDialogue: boolean;
  creativeInstructions: string;
  timezone: string;
};
type Competitor = {
  id: string;
  channelId: string;
  platform: string;
  url: string;
  externalId: string;
  handle: string;
  displayName: string;
  avatar: string;
  status: "Active" | "Paused";
  createdAt: string;
};

const emptyChannel: Omit<Channel, "id"> = {
  name: "",
  platform: "TikTok",
  topic: "",
  subTopic: "",
  targetCountry: "",
  language: "",
  audience: "",
  contentStyle: "",
  visualStyle: "",
  videoDuration: "",
  hasDialogue: false,
  creativeInstructions: "",
  timezone: "UTC",
};

const fields: Array<
  [keyof Omit<Channel, "id" | "hasDialogue">, string, string]
> = [
  ["name", "Tên kênh", "Ví dụ: Funny Animals"],
  ["platform", "Nền tảng", "TikTok, YouTube..."],
  ["topic", "Chủ đề", "Hài hước, Giáo dục..."],
  ["subTopic", "Chủ đề phụ", "Không bắt buộc"],
  ["targetCountry", "Quốc gia / thị trường mục tiêu", "Ví dụ: Việt Nam"],
  ["language", "Ngôn ngữ", "Ví dụ: Tiếng Việt"],
  ["audience", "Khán giả mục tiêu", "Nội dung dành cho ai?"],
  ["contentStyle", "Phong cách nội dung", "Ví dụ: Hài ngắn"],
  ["visualStyle", "Phong cách hình ảnh", "Ví dụ: 3D cách điệu"],
  ["videoDuration", "Thời lượng video (giây)", "Ví dụ: 30"],
  ["timezone", "Timezone", "e.g. Asia/Ho_Chi_Minh"],
];

function toUiChannel(value: Record<string, unknown>): Channel {
  return {
    id: String(value.id),
    name: String(value.name ?? ""),
    platform: String(value.platform ?? ""),
    topic: String(value.topic ?? ""),
    subTopic: String(value.subTopic ?? ""),
    targetCountry: String(value.targetCountry ?? ""),
    language: String(value.language ?? ""),
    audience: String(value.audience ?? ""),
    contentStyle: String(value.contentStyle ?? ""),
    visualStyle: String(value.visualStyle ?? ""),
    videoDuration:
      value.videoDurationSec == null ? "" : String(value.videoDurationSec),
    hasDialogue: Boolean(value.hasDialogue),
    creativeInstructions: String(value.creativeInstructions ?? ""),
    timezone: String(value.timezone ?? "UTC"),
  };
}

function toPayload(channel: Channel) {
  const { id: _id, ...payload } = channel;
  void _id;
  return {
    ...payload,
    videoDuration: channel.videoDuration
      ? Number(channel.videoDuration)
      : undefined,
  };
}

function toUiCompetitor(value: Record<string, unknown>): Competitor {
  return {
    id: String(value.id),
    channelId: String(value.channelId),
    platform: String(value.platform),
    url: String(value.url),
    externalId: String(value.externalId),
    handle: String(value.handle),
    displayName: String(value.displayName ?? value.handle),
    avatar: String(value.avatar ?? ""),
    status: value.status === "ACTIVE" ? "Active" : "Paused",
    createdAt: String(value.createdAt),
  };
}

export function ChannelManager() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Channel | null>(null);
  const [competitorChannel, setCompetitorChannel] = useState<Channel | null>(
    null,
  );
  const [competitors, setCompetitors] = useState<Record<string, Competitor[]>>(
    {},
  );
  useEffect(() => {
    fetch("/api/v1/channels")
      .then(async (response) => {
        if (!response.ok) throw new Error("Không thể tải Channel từ database.");
        const body = (await response.json()) as {
          data: Array<Record<string, unknown>>;
        };
        const loadedChannels = body.data.map(toUiChannel);
        const competitorEntries = await Promise.all(
          loadedChannels.map(async (channel) => {
            try {
              const competitorResponse = await fetch(
                `/api/v1/channels/${channel.id}/competitors`,
              );
              if (!competitorResponse.ok) return [channel.id, []] as const;
              const competitorBody = (await competitorResponse.json()) as {
                data: Array<Record<string, unknown>>;
              };
              return [
                channel.id,
                competitorBody.data.map(toUiCompetitor),
              ] as const;
            } catch {
              return [channel.id, []] as const;
            }
          }),
        );
        setChannels(loadedChannels);
        setCompetitors(Object.fromEntries(competitorEntries));
      })
      .catch((error: unknown) =>
        setNotice(
          error instanceof Error ? error.message : "Không thể tải Channel.",
        ),
      )
      .finally(() => setIsLoading(false));
  }, []);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formError, setFormError] = useState("");

  function openCreate() {
    setFormError("");
    setEditing({ id: crypto.randomUUID(), ...emptyChannel });
    setIsCreating(true);
  }
  function openEdit(channel: Channel) {
    setFormError("");
    setEditing({ ...channel });
    setIsCreating(false);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing?.name.trim()) return;
    const duration = editing.videoDuration ? Number(editing.videoDuration) : undefined;
    if (editing.videoDuration && (!Number.isInteger(duration) || duration! <= 0)) {
      setFormError("Thời lượng video phải là một số giây dương, ví dụ: 30.");
      return;
    }
    setFormError("");
    try {
      const response = await fetch(
        isCreating ? "/api/v1/channels" : `/api/v1/channels/${editing.id}`,
        {
          method: isCreating ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(editing)),
        },
      );
      const body = (await response.json()) as { data: Record<string, unknown> };
      if (!response.ok) {
        const failed = body as { error?: { message?: string } };
        throw new Error(failed.error?.message ?? "Không thể lưu kênh.");
      }
      const saved = toUiChannel(body.data);
      setChannels((current) =>
        isCreating
          ? [...current, saved]
          : current.map((item) => (item.id === saved.id ? saved : item)),
      );
      setEditing(null);
      setNotice("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể lưu kênh.";
      setFormError(message);
      setNotice(message);
    }
  }
  async function remove(channel: Channel) {
    if (!window.confirm(`Xóa Channel “${channel.name}”?`)) return;
    try {
      const response = await fetch(`/api/v1/channels/${channel.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Không thể xóa Channel.");
      setChannels((current) =>
        current.filter((item) => item.id !== channel.id),
      );
      setNotice("");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Không thể xóa Channel.",
      );
    }
  }

  return (
    <section className="mx-auto max-w-6xl">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm text-[#00a7c9]">KHÔNG GIAN LÀM VIỆC</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#0b3262]">
            Kênh của tôi
          </h2>
          <p className="mt-2 text-sm text-[#6883aa]">
            Mỗi Channel là một workspace độc lập cho content modeling.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-[#05c7e5] px-4 py-2.5 text-sm font-semibold text-[#06315d] transition hover:bg-[#00b8d4]"
        >
          + Tạo kênh mới
        </button>
      </div>
      {notice && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {notice}
        </div>
      )}
      {isLoading ? (
        <div className="mt-8 rounded-xl border border-dashed border-[#cbd9ea] bg-white p-10 text-center text-sm text-[#6883aa]">
          Đang tải danh sách kênh...
        </div>
      ) : (
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {channels.map((channel) => (
          <article
            key={channel.id}
            className="group rounded-xl border border-[#d8e3f1] bg-white p-5 shadow-sm transition hover:border-cyan-400/60 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-[#0b3262]">{channel.name}</h3>
                <p className="mt-1 text-sm text-[#6883aa]">
                  {channel.targetCountry}{" "}
                  <span className="text-[#9ab0c9]">•</span> {channel.platform}{" "}
                  <span className="text-[#9ab0c9]">•</span> {channel.topic}
                </p>
              </div>
              <span className="rounded-full bg-[#dff7f4] px-2 py-1 text-[11px] text-[#078f86]">
                Đang hoạt động
              </span>
            </div>
            <div className="mt-6 flex flex-wrap gap-2 border-t border-[#e5edf6] pt-4">
              <button
                onClick={() => setSelected(channel)}
                className="rounded-md px-3 py-2 text-xs text-[#0b5799] hover:bg-[#eef6ff]"
              >
                Xem
              </button>
              <button
                onClick={() => openEdit(channel)}
                className="rounded-md px-3 py-2 text-xs text-[#0b5799] hover:bg-[#eef6ff]"
              >
                Sửa
              </button>
              <button
                onClick={() => setCompetitorChannel(channel)}
                className="rounded-md px-3 py-2 text-xs text-[#008fbd] hover:bg-[#e8faff]"
              >
                Đối thủ ({competitors[channel.id]?.length ?? 0})
              </button>
              <button
                onClick={() => remove(channel)}
                className="ml-auto rounded-md px-3 py-2 text-xs text-rose-500 hover:bg-rose-50"
              >
                Xóa
              </button>
            </div>
          </article>
        ))}
        {channels.length === 0 && (
          <div className="rounded-xl border border-dashed border-[#cbd9ea] bg-white p-10 text-center text-sm text-[#6883aa] lg:col-span-3">
            Chưa có Channel. Tạo Channel đầu tiên để bắt đầu.
          </div>
        )}
      </div>
      )}
      {editing && (
        <ChannelModal
          channel={editing}
          title={isCreating ? "Tạo kênh mới" : "Chỉnh sửa kênh"}
          error={formError}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      {selected && (
        <ChannelDetails
          channel={selected}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setSelected(null);
            openEdit(selected);
          }}
        />
      )}
      {competitorChannel && (
        <CompetitorManager
          channel={competitorChannel}
          items={competitors[competitorChannel.id] ?? []}
          onClose={() => setCompetitorChannel(null)}
          onChange={(items) =>
            setCompetitors((current) => ({
              ...current,
              [competitorChannel.id]: items,
            }))
          }
        />
      )}
    </section>
  );
}

function ChannelModal({
  channel,
  title,
  error,
  onChange,
  onClose,
  onSave,
}: {
  channel: Channel;
  title: string;
  error: string;
  onChange: (channel: Channel) => void;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <form
        onSubmit={onSave}
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-cyan-400">
              CẤU HÌNH KÊNH
            </p>
            <h3 className="mt-1 text-xl font-semibold text-white">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-2xl text-slate-500 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {fields.map(([key, label, placeholder]) => (
            <label key={key} className="text-sm text-slate-300">
              {label}
              <input
                type={key === "videoDuration" ? "number" : "text"}
                min={key === "videoDuration" ? 1 : undefined}
                step={key === "videoDuration" ? 1 : undefined}
                required={
                  key === "name" || key === "platform" || key === "topic"
                }
                value={channel[key]}
                onChange={(event) =>
                  onChange({ ...channel, [key]: event.target.value })
                }
                placeholder={placeholder}
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400"
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2"><span className="text-xs text-slate-400">Chọn nhanh thời lượng:</span>{[15, 30, 60, 180].map((seconds) => <button type="button" key={seconds} onClick={() => onChange({ ...channel, videoDuration: String(seconds) })} className="rounded border border-white/15 px-2 py-1 text-xs text-cyan-300 hover:bg-white/10">{seconds} giây</button>)}</div>
        <label className="mt-4 flex items-center gap-3 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={channel.hasDialogue}
            onChange={(event) =>
              onChange({ ...channel, hasDialogue: event.target.checked })
            }
            className="h-4 w-4 accent-cyan-400"
          />{" "}
          Có lời thoại
        </label>
        <label className="mt-4 block text-sm text-slate-300">
          Hướng dẫn sáng tạo
          <textarea
            value={channel.creativeInstructions}
            onChange={(event) =>
              onChange({ ...channel, creativeInstructions: event.target.value })
            }
            rows={3}
            placeholder="Guidelines the AI should follow..."
            className="mt-1.5 w-full resize-y rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400"
          />
        </label>
        {error && <p role="alert" className="mt-4 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm text-slate-300 hover:bg-white/10"
          >
            Hủy
          </button>
          <button
            type="submit"
            className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
          >
            Lưu kênh
          </button>
        </div>
      </form>
    </div>
  );
}

function ChannelDetails({
  channel,
  onClose,
  onEdit,
}: {
  channel: Channel;
  onClose: () => void;
  onEdit: () => void;
}) {
  const details = [
    ["Quốc gia / thị trường mục tiêu", channel.targetCountry],
    ["Ngôn ngữ", channel.language],
    ["Khán giả mục tiêu", channel.audience],
    ["Phong cách nội dung", channel.contentStyle],
    ["Phong cách hình ảnh", channel.visualStyle],
    ["Thời lượng video", `${channel.videoDuration || "—"} giây`],
    ["Có lời thoại", channel.hasDialogue ? "Có" : "Không"],
    ["Timezone", channel.timezone],
  ];
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-cyan-400">
              THÔNG TIN KÊNH
            </p>
            <h3 className="mt-1 text-2xl font-semibold text-white">
              {channel.name}
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              {channel.platform} · {channel.topic}
              {channel.subTopic ? ` · ${channel.subTopic}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-2xl text-slate-500 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <dl className="mt-6 grid gap-4 border-t border-white/10 pt-5 sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="mt-1 text-sm text-slate-200">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 rounded-lg bg-white/[.04] p-4">
          <p className="text-xs text-slate-500">Hướng dẫn sáng tạo</p>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            {channel.creativeInstructions || "Chưa có hướng dẫn riêng."}
          </p>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm text-slate-300 hover:bg-white/10"
          >
            Đóng
          </button>
          <button
            onClick={onEdit}
            className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
          >
            Chỉnh sửa kênh
          </button>
        </div>
      </div>
    </div>
  );
}

function CompetitorManager({
  channel,
  items,
  onClose,
  onChange,
}: {
  channel: Channel;
  items: Competitor[];
  onClose: () => void;
  onChange: (items: Competitor[]) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [bulkMessage, setBulkMessage] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  useEffect(() => {
    fetch(`/api/v1/channels/${channel.id}/competitors`)
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Không thể tải competitor từ database.");
        const body = (await response.json()) as {
          data: Array<Record<string, unknown>>;
        };
        onChange(body.data.map(toUiCompetitor));
      })
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Không thể tải competitor.",
        ),
      );
    // The parent callback is intentionally not a dependency: it is an inline state adapter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);
  async function createCompetitor(value: string) {
    const response = await fetch(`/api/v1/channels/${channel.id}/competitors`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: value }) });
    const body = (await response.json()) as { data?: Record<string, unknown>; error?: { message?: string } };
    if (!response.ok || !body.data) throw new Error(body.error?.message ?? "Không thể thêm đối thủ.");
    return toUiCompetitor(body.data);
  }
  async function addCompetitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { const created = await createCompetitor(url); onChange([...items, created]); setUrl(""); setError(""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "URL không hợp lệ."); }
  }
  async function importTxt(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".txt")) { setError("Chỉ hỗ trợ file .txt, mỗi dòng một URL."); return; }
    const links = [...new Set((await file.text()).split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
    if (!links.length) { setError("File chưa có URL hợp lệ."); return; }
    if (links.length > 50) { setError("Mỗi file tối đa 50 URL."); return; }
    setError(""); setBulkMessage(""); setIsImporting(true);
    const nextItems = [...items]; const failures: string[] = [];
    for (const link of links) {
      try { nextItems.push(await createCompetitor(link)); }
      catch (caught) { failures.push(`${link}: ${caught instanceof Error ? caught.message : "không hợp lệ"}`); }
    }
    onChange(nextItems); setIsImporting(false);
    setBulkMessage(`Đã thêm ${nextItems.length - items.length}/${links.length} URL.${failures.length ? ` Không thêm được: ${failures.join(" | ")}` : ""}`);
  }
  async function toggle(item: Competitor) {
    const status = item.status === "Active" ? "INACTIVE" : "ACTIVE";
    const response = await fetch(`/api/v1/competitors/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      setError("Không thể cập nhật trạng thái competitor.");
      return;
    }
    onChange(
      items.map((current) =>
        current.id === item.id
          ? { ...current, status: status === "ACTIVE" ? "Active" : "Paused" }
          : current,
      ),
    );
  }
  async function remove(item: Competitor) {
    try {
      const response = await fetch(`/api/v1/competitors/${item.id}`, {
        method: "DELETE",
      });
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "Không thể xóa đối thủ.");
      }
      onChange(items.filter((current) => current.id !== item.id));
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Không thể xóa đối thủ.",
      );
    }
  }
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-cyan-400">
              ĐỐI THỦ
            </p>
            <h3 className="mt-1 text-2xl font-semibold text-white">
              {channel.name}
            </h3>
              <p className="mt-1 text-sm text-slate-400">
                Thêm 10–50 URL đối thủ cho kênh này.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-2xl text-slate-500 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <form
          onSubmit={addCompetitor}
          className="mt-6 flex flex-col gap-3 sm:flex-row"
        >
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://tiktok.com/@... hoặc https://youtube.com/@..."
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400"
          />
          <button
            type="submit"
            className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
          >
            Thêm URL đối thủ
          </button>
        </form>
        <div className="mt-3 rounded-lg border border-dashed border-white/15 bg-white/[.03] p-3">
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-slate-300"><span><strong className="text-white">Thêm hàng loạt từ file TXT</strong><span className="mt-1 block text-xs text-slate-500">Mỗi dòng một URL, tối đa 50 URL.</span></span><span className="rounded-lg border border-cyan-400/40 px-3 py-2 text-xs font-semibold text-cyan-300">{isImporting ? "Đang thêm..." : "Chọn file .txt"}</span><input type="file" accept=".txt,text/plain" className="sr-only" disabled={isImporting} onChange={(event) => void importTxt(event)} /></label>
        </div>
        {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
        {bulkMessage && <p className="mt-2 break-words text-sm text-emerald-300">{bulkMessage}</p>}
        <div className="mt-6 overflow-hidden rounded-lg border border-white/10">
          <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-white/10 bg-white/[.04] px-4 py-3 text-xs uppercase tracking-wider text-slate-500">
            <span>Đối thủ</span>
            <span>Trạng thái</span>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              Chưa có competitor URL.
            </p>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-white/5 px-4 py-4 last:border-0"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-300">
                      {item.platform}
                    </span>
                    <p className="font-medium text-white">{item.displayName}</p>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {item.url}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    id: {item.id} · channelId: {item.channelId} · externalId:{" "}
                    {item.externalId} · handle: {item.handle} · createdAt:{" "}
                    {new Date(item.createdAt).toLocaleDateString("vi-VN")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggle(item)}
                    className={`rounded-full px-2.5 py-1 text-[11px] ${item.status === "Active" ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}
                  >
                  {item.status === "Active" ? "Đang hoạt động" : "Tạm dừng"}
                  </button>
                  <button
                    onClick={() => remove(item)}
                    className="rounded-md px-2 py-1 text-xs text-rose-300 hover:bg-rose-400/10"
                  >
                    Xóa
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm text-slate-300 hover:bg-white/10"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
