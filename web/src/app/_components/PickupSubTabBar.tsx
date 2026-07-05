"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "チャート" },
  { href: "/pullback", label: "Pickup" },
  { href: "/popular", label: "人気履歴" },
] as const;

const monoFont = '"SF Mono",SFMono-Regular,ui-monospace,"Roboto Mono",Menlo,Consolas,monospace';

/**
 * ⭐Pickupカテゴリの3サブタブ(チャート="/" / Pickup="/pullback" / 人気履歴="/popular")。
 * それぞれ独立したページ(サーバー側データ取得も別)のため、クライアントstateではなく
 * next/linkによるURL遷移でタブ切り替えを行う(既存の/pullback・/popularのデータ取得を
 * 統合するコストとリスクを避けるため)。
 * 見た目は/rankingのメインタブ(売買代金/回転率/S高)のセグメンテッドコントロールを流用。
 *
 * dark: /pullback・/popularの背景色(#17171a)に合わせた配色にするかどうか。
 * "/"(旧PickupClient)側はライトテーマのカード一覧のため、この指定はfalseで使う。
 */
export function PickupSubTabBar({ dark = false }: { dark?: boolean }) {
  const pathname = usePathname();

  return (
    <div
      style={{
        display: "flex",
        gap: 2,
        marginBottom: 12,
        marginLeft: dark ? 16 : 0,
        marginRight: dark ? 16 : 0,
        padding: 3,
        borderRadius: 9999,
        background: "#1c1c1f",
        border: "1px solid #2a2d34",
      }}
    >
      {TABS.map(({ href, label }) => {
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            style={{
              flex: 1,
              padding: "8px 0",
              borderRadius: 9999,
              fontFamily: monoFont,
              fontSize: 13,
              textAlign: "center",
              border: "none",
              transition: "background 0.15s, color 0.15s, box-shadow 0.15s",
              background: isActive ? "#46494d" : "transparent",
              boxShadow: isActive ? "0 1px 3px rgba(0,0,0,0.4)" : "none",
              color: isActive ? "#e8eaed" : "#8e8e93",
              fontWeight: isActive ? 600 : 500,
            }}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
