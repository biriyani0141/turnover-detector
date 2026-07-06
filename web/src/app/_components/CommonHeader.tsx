"use client";
import { usePathname } from "next/navigation";
import { useHeaderValue } from "./HeaderContext";
import { PickupSubTabBar } from "./PickupSubTabBar";
import { DateSelector } from "./DateSelector";

// PickupSubTabBar(⭐Pickupのチャート/Pickup/人気履歴)を表示する3ルート。
// TabBar.tsx の matchPaths(⭐Pickupアイコン分)と一致させること。
const SEGMENT_PATHS = ["/", "/pullback", "/popular"];

export function CommonHeader() {
  const pathname = usePathname();
  const { date, count, dateSelector, descToggle } = useHeaderValue();
  const showSegment = SEGMENT_PATHS.includes(pathname);

  return (
    <div style={{ paddingTop: 12, paddingLeft: 12, paddingRight: 12 }}>
      <div
        className="flex items-center"
        style={{
          fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
          fontSize: 11,
          color: "#707A8A",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.01em",
          minHeight: 24.5,
          marginBottom: descToggle?.open ? 4 : 8,
        }}
      >
        {date}
        {count && (
          <>
            <span style={{ margin: "0 4px" }}>·</span>
            <span style={{ fontWeight: 600 }}>{count}</span>
          </>
        )}
        {descToggle && (
          <button
            type="button"
            onClick={descToggle.onToggle}
            aria-expanded={descToggle.open}
            aria-label="説明を表示"
            style={{
              padding: 2,
              marginLeft: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "none",
              flexShrink: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#707A8A">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" />
            </svg>
          </button>
        )}
        {dateSelector && (
          <DateSelector
            availableDates={dateSelector.availableDates}
            selectedDate={dateSelector.selectedDate}
            onChange={dateSelector.onChange}
          />
        )}
      </div>
      {descToggle?.open && (
        <p
          className="text-[11px] leading-5 whitespace-pre-line"
          style={{ color: "#9CA3AF", marginBottom: 8 }}
        >
          {descToggle.description}
        </p>
      )}
      {showSegment && <PickupSubTabBar />}
    </div>
  );
}
