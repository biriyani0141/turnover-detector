"use client";
import { useState, type ReactNode } from "react";

type PageHeaderProps = {
  title?: string;
  date: string | undefined;
  description: string;
  rightContent?: ReactNode;
};

const DATE_COLOR = "#71717A";

export function PageHeader({ title, date, description, rightContent }: PageHeaderProps) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ paddingLeft: 16, paddingRight: 16 }}>
      {title && (
        <h1 className="font-sans font-bold text-base leading-tight text-gray-100 mb-1">
          {title}
        </h1>
      )}
      <div className="flex items-center" style={{ marginBottom: open ? 8 : 12 }}>
        <p className="text-xs" style={{ color: DATE_COLOR }}>
          {date}
        </p>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="説明を表示"
          style={{
            width: 44,
            height: 44,
            marginLeft: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            flexShrink: 0,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={DATE_COLOR}>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" />
          </svg>
        </button>
        {rightContent && (
          <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
            {rightContent}
          </div>
        )}
      </div>
      {open && (
        <p
          className="text-[11px] leading-5 whitespace-pre-line"
          style={{ color: "#9CA3AF", marginBottom: 12 }}
        >
          {description}
        </p>
      )}
    </div>
  );
}
