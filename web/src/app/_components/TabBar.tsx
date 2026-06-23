"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/ranking", icon: "currency_yen" },
  { href: "/", icon: "cycle" },
  { href: "/popular", icon: "finance_mode" },
  { href: "/pullback", icon: "electric_bolt" },
];

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="flex border-b"
      style={{ borderColor: "#1F1F23", backgroundColor: "#09090B" }}
    >
      {tabs.map(({ href, icon }) => {
        const isActive = pathname === href;
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
              }}
            >
              {icon}
            </span>
            <span
              style={{
                width: 28,
                height: 2,
                borderRadius: 2,
                backgroundColor: isActive ? "#e3e3e3" : "transparent",
                display: "block",
              }}
            />
          </Link>
        );
      })}
    </nav>
  );
}
