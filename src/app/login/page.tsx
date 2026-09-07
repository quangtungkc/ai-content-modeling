"use client";

import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Vui lòng nhập đầy đủ email và mật khẩu.");
      return;
    }
    if (mode === "register" && password.length < 10) {
      setError("Mật khẩu cần tối thiểu 10 ký tự.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password, ...(mode === "register" ? { name } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error?.message ?? "Không thể xác thực. Vui lòng thử lại.");
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Không kết nối được tới server local. Hãy tải lại trang và thử lại.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f7fb] p-5">
      <form onSubmit={submit} noValidate className="w-full max-w-md rounded-2xl border border-[#d8e3f1] bg-white p-8 shadow-lg">
        <p className="text-xs font-extrabold tracking-[0.18em] text-teal-600">MODELING AI</p>
        <h1 className="mt-2 text-3xl font-extrabold text-[#0b3262]">{mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</h1>
        <p className="mt-2 text-sm text-[#6883aa]">Truy cập workspace AI Content Modeling của bạn.</p>
        {mode === "register" && <label className="mt-6 block text-sm font-semibold text-[#0b3262]">Tên<input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-lg border border-[#cbd9ea] px-3 py-3" /></label>}
        <label className="mt-5 block text-sm font-semibold text-[#0b3262]">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-lg border border-[#cbd9ea] px-3 py-3" /></label>
        <label className="mt-5 block text-sm font-semibold text-[#0b3262]">Mật khẩu<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 w-full rounded-lg border border-[#cbd9ea] px-3 py-3" /></label>
        {error && <p role="alert" className="mt-4 text-sm font-medium text-rose-600">{error}</p>}
        <button disabled={isSubmitting} className="mt-6 w-full rounded-lg bg-[#07865f] py-3 font-bold text-white disabled:cursor-wait disabled:opacity-70">{isSubmitting ? "Đang xử lý..." : mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</button>
        <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} className="mt-4 w-full text-sm font-bold text-[#0b5799]">{mode === "login" ? "Chưa có tài khoản? Đăng ký" : "Đã có tài khoản? Đăng nhập"}</button>
      </form>
    </main>
  );
}
