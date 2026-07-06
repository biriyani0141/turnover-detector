"use client";

// pickedがavailableDates(昇順)のいずれとも一致しない場合(週末・休場日等)、
// picked以前で最も新しい利用可能日にスナップする。pickedが最古日より前ならそれを返す。
function snapToAvailableDate(picked: string, availableDates: string[]): string {
  let result = availableDates[0];
  for (const d of availableDates) {
    if (d <= picked) result = d;
    else break;
  }
  return result;
}

export function DateSelector({
  availableDates,
  selectedDate,
  onChange,
}: {
  availableDates: string[];
  selectedDate: string | null;
  onChange: (date: string | null) => void;
}) {
  if (availableDates.length < 2) return null;

  const latest = availableDates[availableDates.length - 1];
  const earliest = availableDates[0];
  const current = selectedDate ?? latest;
  const idx = availableDates.indexOf(current);
  if (idx === -1) return null;

  const isLatest = idx === availableDates.length - 1;
  const label = current.slice(5).replace("-", "/");

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center", marginLeft: "auto" }}>
      <span
        style={{
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
          color: isLatest ? "#707A8A" : "#c8d0da",
          minWidth: 34,
          textAlign: "center",
          letterSpacing: "0.02em",
          padding: "3px 8px",
          borderRadius: 6,
          border: "1px solid #4a4d52",
          background: "#2a2c2f",
        }}
      >
        {label}
      </span>
      <input
        type="date"
        value={current}
        min={earliest}
        max={latest}
        aria-label="日付を選択"
        onChange={(e) => {
          const picked = e.target.value;
          if (!picked) return;
          const snapped = snapToAvailableDate(picked, availableDates);
          onChange(snapped === latest ? null : snapped);
        }}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0,
          cursor: "pointer",
          border: "none",
          padding: 0,
          margin: 0,
        }}
      />
    </div>
  );
}
