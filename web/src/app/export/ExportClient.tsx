"use client";
import { useEffect, useState } from "react";
import { EXPORT_CHANNEL_NAME, type ExportChannelMessage } from "@/lib/cardGridExport";

// 生成元タブが離脱する等で一切メッセージが届かない場合に「生成中…」のまま孤立させないための待機上限。
const RECEIVE_TIMEOUT_MS = 30_000;

export default function ExportClient() {
  const [meta, setMeta] = useState<{ title: string; label: string } | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const channel = new BroadcastChannel(EXPORT_CHANNEL_NAME);
    const timer = setTimeout(() => setTimedOut(true), RECEIVE_TIMEOUT_MS);

    channel.onmessage = (event: MessageEvent<ExportChannelMessage>) => {
      clearTimeout(timer);
      const { title, label, pages } = event.data;
      setMeta({ title, label });
      setUrls(pages.map((blob) => URL.createObjectURL(blob)));
    };

    return () => {
      clearTimeout(timer);
      channel.close();
    };
  }, []);

  useEffect(() => {
    if (meta) document.title = meta.title;
  }, [meta]);

  // blob URLはこのページ限りでしか使わないため、アンマウント時にまとめて解放する。
  useEffect(() => {
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [urls]);

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
        <img key={url} src={url} alt={`${meta?.title ?? ""} ${i + 1}`} style={{ display: "block", width: "100%" }} />
      ))}
    </div>
  );
}
