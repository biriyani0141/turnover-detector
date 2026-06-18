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
    <nav className="flex border-b border-gray-200 bg-white">
      {tabs.map(({ href, label }) => {
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`flex-1 text-center py-3 text-sm font-medium ${
              isActive
                ? "text-gray-900 border-b-2 border-gray-900"
                : "text-gray-400"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
