"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "回転率" },
  { href: "/popular", label: "人気継続" },
  { href: "/pullback", label: "押し目" },
];

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="flex border-b"
      style={{ borderColor: "#1F1F23", backgroundColor: "#09090B" }}
    >
      {tabs.map(({ href, label }) => {
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 text-center py-3 text-sm font-medium border-b-2 ${
              isActive ? "border-[#F4F4F5]" : "border-transparent"
            }`}
            style={{ color: isActive ? "#F4F4F5" : "#71717A" }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
