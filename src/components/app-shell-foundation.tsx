"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type NotificationKind = "info" | "success" | "warning" | "error";
type Notification = { id: string; kind: NotificationKind; message: string };
type NotificationContextValue = { notify: (message: string, kind?: NotificationKind) => string; dismiss: (id: string) => void };

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [items, setItems] = useState<Notification[]>([]);
  const value = useMemo<NotificationContextValue>(() => ({
    notify: (message, kind = "info") => {
      const id = crypto.randomUUID();
      setItems((current) => [...current, { id, kind, message }].slice(-4));
      return id;
    },
    dismiss: (id) => setItems((current) => current.filter((item) => item.id !== id)),
  }), []);

  return <NotificationContext.Provider value={value}>
    {children}
    <div className="fixed right-4 top-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite" aria-label="Thông báo">
      {items.map((item) => <div className="rounded-lg border border-[#cbd9ea] bg-white px-4 py-3 text-sm text-[#0b3262] shadow-lg" data-kind={item.kind} key={item.id}>
        <div className="flex items-start justify-between gap-3"><span>{item.message}</span><button type="button" className="font-bold text-[#6883aa]" aria-label="Đóng thông báo" onClick={() => value.dismiss(item.id)}>×</button></div>
      </div>)}
    </div>
  </NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useNotifications must be used inside NotificationProvider");
  return context;
}

export function PageContainer({ children, className = "" }: Readonly<{ children: ReactNode; className?: string }>) {
  return <div className={`mx-auto w-full max-w-[1440px] ${className}`}>{children}</div>;
}

export function EmptyState({ title, description, action }: Readonly<{ title: string; description?: string; action?: ReactNode }>) {
  return <div className="rounded-xl border border-dashed border-[#cbd9ea] bg-white p-8 text-center">
    <p className="text-base font-bold text-[#0b3262]">{title}</p>
    {description && <p className="mt-2 text-sm text-[#6883aa]">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>;
}

export function FormError({ message }: Readonly<{ message?: string | null }>) {
  if (!message) return null;
  return <p className="text-sm font-semibold text-red-700" role="alert">{message}</p>;
}

export function AppDialog({ open, title, children, onClose, footer }: Readonly<{ open: boolean; title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }>) {
  if (!open) return null;
  return <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#071d38]/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex items-center justify-between gap-4"><h2 className="text-lg font-bold text-[#0b3262]">{title}</h2><button type="button" className="text-xl text-[#6883aa]" aria-label="Đóng hộp thoại" onClick={onClose}>×</button></div>
      <div className="mt-4">{children}</div>
      {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
    </section>
  </div>;
}
