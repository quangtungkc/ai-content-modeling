"use client";

export default function GlobalError({ reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return <html lang="vi"><body style={{ margin: 0, background: "#f4f7fb", color: "#0b3262", fontFamily: "Arial, Helvetica, sans-serif" }}><main style={{ display: "grid", minHeight: "100vh", placeItems: "center", padding: 24, textAlign: "center" }}><div><h1>Ứng dụng tạm thời không khả dụng</h1><p>Vui lòng thử tải lại nội dung.</p><button type="button" onClick={() => reset()}>Tải lại</button></div></main></body></html>;
}
