"use client";

import { useEffect } from "react";
import { notifyRuntimeFailure } from "@/components/runtime-error-monitor";

export default function Error({ error, reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  useEffect(() => { notifyRuntimeFailure(error, { boundary: "app" }); }, [error]);
  return <div className="mx-auto flex min-h-[40vh] max-w-xl flex-col items-center justify-center text-center">
    <h1 className="text-xl font-bold text-[#0b3262]">Không thể tải nội dung</h1>
    <p className="mt-2 text-sm text-[#6883aa]">Đã xảy ra lỗi an toàn ở ứng dụng. Bạn có thể thử lại.</p>
    <button type="button" className="mt-5 rounded-lg bg-[#0b5799] px-4 py-2 text-sm font-bold text-white" onClick={() => reset()}>Thử lại</button>
  </div>;
}
