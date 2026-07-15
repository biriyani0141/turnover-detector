"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  // ⭐Pickup: チャート("/")・Pickup("/pullback")・人気履歴("/popular")の3ページをまとめて
  // このアイコン配下として扱う(サブタブはPickupSubTabBarで各ページ内に表示する)。
  { href: "/", icon: "electric_bolt", matchPaths: ["/", "/pullback", "/popular"] },
  { href: "/stophigh", icon: "rocket_launch", matchPaths: ["/stophigh"] },
  { href: "/turnover", icon: "cycle", matchPaths: ["/turnover"] },
  { href: "/ranking", icon: "list_alt", matchPaths: ["/ranking"] },
  // 暴落: /crashは認証撤廃済み・共通レイアウト(TabBar/CommonHeader)配下のため、
  // 既存タブと同じLink遷移方式で統合する。特別扱い不要。
  { href: "/crash", icon: "trending_down", matchPaths: ["/crash"] },
];

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="flex border-b"
      style={{ borderColor: "#1F1F23", backgroundColor: "#09090B" }}
    >
      {tabs.map(({ href, icon, matchPaths }) => {
        const isActive = matchPaths.includes(pathname);
        return (
          <Link
            key={href}
            href={href}
            className="flex-1 flex flex-col items-center py-3"
            style={{ gap: 4 }}
          >
            <span
              className="material-symbols-rounded"
              style={{
                fontSize: 24,
                color: isActive ? "#e3e3e3" : "#5f6368",
                fontVariationSettings: "'FILL' 1,'wght' 400,'GRAD' 0,'opsz' 24",
                backgroundColor: isActive ? "rgba(255, 255, 255, 0.12)" : "transparent",
                borderRadius: 8,
                padding: "6px 10px",
              }}
            >
              {icon}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
