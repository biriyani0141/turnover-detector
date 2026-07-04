"use client";
import { useEffect, useRef, useState } from "react";
import { EXPORT_STORAGE_KEY, type ExportPayload } from "@/lib/cardGridExport";

// 生成元タブが離脱する等で一切データが届かない場合に「生成中…」のまま孤立させないための待機上限。
const RECEIVE_TIMEOUT_MS = 30_000;

export default function ExportClient() {
  const [meta, setMeta] = useState<{ title: string; label: string } | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [timedOut, setTimedOut] = useState(false);
  const consumedRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), RECEIVE_TIMEOUT_MS);

    // localStorageから読み取り、あれば消費して表示する。マウント時・visibilitychange時・
    // storageイベント時の3経路すべてから呼ぶことで、いずれのタイミングで書き込まれても取りこぼさない
    // (iOS Safariで新規タブがバックグラウンド扱いの間はイベントが遅延することがあるため)。
    function tryConsume() {
      if (consumedRef.current) return;
      const raw = localStorage.getItem(EXPORT_STORAGE_KEY);
      if (!raw) return;
      let payload: ExportPayload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      consumedRef.current = true;
      localStorage.removeItem(EXPORT_STORAGE_KEY);
      clearTimeout(timer);
      setMeta({ title: payload.title, label: payload.label });
      setUrls(payload.pages);
    }

    tryConsume();

    const onVisibility = () => {
      if (document.visibilityState === "visible") tryConsume();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onStorage = (e: StorageEvent) => {
      if (e.key === EXPORT_STORAGE_KEY) tryConsume();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    if (meta) document.title = meta.title;
  }, [meta]);

  if (urls.length === 0) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F4F6FB",
          fontFamily: "ui-monospace, monospace",
          fontSize: 13,
          color: "#707A8A",
          textAlign: "center",
          padding: 24,
        }}
      >
        {timedOut
          ? "画像の生成に失敗しました(タイムアウト)。元のタブを確認して、もう一度お試しください。"
          : "画像生成中…"}
      </div>
    );
  }

  return (
    <div style={{ margin: 0, background: "#F4F6FB", minHeight: "100vh" }}>
      {urls.map((url, i) => (
        <img key={i} src={url} alt={`${meta?.title ?? ""} ${i + 1}`} style={{ display: "block", width: "100%" }} />
      ))}
    </div>
  );
}
