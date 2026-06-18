"use client";
import { useEffect, useState, useMemo } from "react";

type Row = {
  code: string;
  name: string;
  mktcap_oku: number | null;
  first_date: string;
  ret_1d: number | null;
  ret_5d: number | null;
  ret_1m: number | null;
  ret_3m: number | null;
  ret_1y: number | null;
  close: number | null;
  [key: string]: any;
};

type Excluded = { code: string; name: string; reason: string };

const WIN_OPTIONS = [25, 50, 100, 200] as const;
type Win = (typeof WIN_OPTIONS)[number];

const CAP_FILTERS = [
  { label: "全部", key: "all" },
  { label: "100億以下", key: "le100" },
  { label: "300億以下", key: "le300" },
  { label: "1000億以下", key: "le1000" },
  { label: "2000億以下", key: "le2000" },
  { label: "2000億以上", key: "ge2000" },
] as const;
type CapFilter = (typeof CAP_FILTERS)[number]["key"];

function pct(v: number | null): string {
  return v === null || v === undefined ? "-" : v.toFixed(1) + "%";
}
function colorOf(v: number | null): string {
  if (v === null || v === undefined) return "text-gray-400";
  if (v > 0) return "text-green-600";
  if (v < 0) return "text-red-600";
  return "text-gray-600";
}
function darkColorStyle(v: number | null) {
  const cls = colorOf(v);
  if (cls === "text-green-600") return { color: "#10B981" };
  if (cls === "text-red-600") return { color: "#EF4444" };
  return { color: "#71717A" };
}
function fmtCode(code: string): string {
  if (/^\d{5}$/.test(code) && code.endsWith("0")) return code.slice(0, 4);
  return code;
}
function fmtCap(v: number | null): string {
  if (v === null || v === undefined) return "-";
  return v.toLocaleString("ja-JP", { maximumFractionDigits: 0 }) + "億";
}
function applyCapFilter(row: Row, cap: CapFilter): boolean {
  if (cap === "all") return true;
  if (row.mktcap_oku === null) return false;
  if (cap === "le100")  return row.mktcap_oku <= 100;
  if (cap === "le300")  return row.mktcap_oku <= 300;
  if (cap === "le1000") return row.mktcap_oku <= 1000;
  if (cap === "le2000") return row.mktcap_oku <= 2000;
  if (cap === "ge2000") return row.mktcap_oku >= 2000;
  return true;
}

const matrixGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  columnGap: 8,
  width: "100%",
} as const;

export default function PopularPage() {
  const [allData, setAllData] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [excluded, setExcluded] = useState<Excluded[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [win, setWin] = useState<Win>(25);
  const [capFilter, setCapFilter] = useState<CapFilter>("all");

  useEffect(() => {
    Promise.all([
      fetch("/data/popular.json").then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }),
      fetch("/data/excluded.json")
        .then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .catch((e) => {
          console.error("excluded.json fetch failed:", e);
          return { excluded: [] };
        }),
    ])
      .then(([popularData, excludedData]) => {
        setMeta(popularData._meta);
        setAllData(popularData.popular);
        setExcluded(excludedData.excluded ?? []);
      })
      .catch((e) => setErr(String(e)));
  }, []);

  const rows = useMemo(() => {
    if (!allData) return null;
    const excludedCodes = new Set(excluded.map((e) => e.code));
    return allData
      .filter((r) => !excludedCodes.has(r.code))
      .filter((r) => applyCapFilter(r, capFilter))
      .sort((a, b) => (b[`turnover_${win}`] ?? 0) - (a[`turnover_${win}`] ?? 0))
      .slice(0, 50);
  }, [allData, excluded, win, capFilter]);

  if (err) return <pre className="p-4 text-red-600">ERROR: {err}</pre>;
  if (!rows) return <div className="p-4">loading...</div>;

  return (
    <div className="p-3" style={{ backgroundColor: "#09090B", minHeight: "100vh" }}>
      <h1 className="text-base font-bold mb-1" style={{ color: "#F4F4F5" }}>
        人気継続（出現＋S高）
      </h1>
      <p className="text-xs mb-3" style={{ color: "#71717A" }}>
        {meta?.date} ／ 上位50件
      </p>

      {/* 窓切替 */}
      <div className="flex flex-wrap gap-1 mb-2">
        {WIN_OPTIONS.map((w) => (
          <button
            key={w}
            onClick={() => setWin(w)}
            className="px-3 py-1 text-xs rounded border"
            style={
              win === w
                ? { backgroundColor: "#F4F4F5", color: "#09090B", borderColor: "#F4F4F5" }
                : { backgroundColor: "#121214", color: "#71717A", borderColor: "#27272A" }
            }
          >
            {w}日
          </button>
        ))}
      </div>

      {/* 時価総額フィルタ */}
      <div className="flex flex-wrap gap-1 mb-3">
        {CAP_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setCapFilter(f.key)}
            className="px-3 py-1 text-xs rounded border"
            style={
              capFilter === f.key
                ? { backgroundColor: "#2563EB", color: "#F4F4F5", borderColor: "#2563EB" }
                : { backgroundColor: "#121214", color: "#71717A", borderColor: "#27272A" }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* リスト */}
      <div>
        {/* ヘッダ行 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            paddingLeft: 16,
            paddingRight: 12,
            marginBottom: 4,
          }}
        >
          <div style={{ width: "40%", fontSize: 11, fontFamily: "monospace", color: "#71717A" }}>
            銘柄
          </div>
          <div style={{ width: 1, flexShrink: 0, marginLeft: 8, marginRight: 8 }} />
          <div style={{ width: "20%", fontSize: 11, fontFamily: "monospace", color: "#71717A" }}>
            1d
          </div>
          <div style={{ width: 1, flexShrink: 0, marginLeft: 8, marginRight: 8 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={matrixGridStyle}>
              {["5d", "1m", "3m", "1y"].map((label) => (
                <span
                  key={label}
                  style={{ fontSize: 11, fontFamily: "monospace", color: "#71717A", textAlign: "right" }}
                >
                  {label}
                </span>
              ))}
            </div>
            <div style={{ textAlign: "right", width: "100%", fontSize: 11, fontFamily: "monospace", color: "#71717A" }}>
              出現
            </div>
          </div>
        </div>

        {rows.map((r) => {
          const t = (r as any)[`turnover_${win}`] ?? 0;
          const s = (r as any)[`stophigh_${win}`] ?? 0;
          return (
            <div
              key={r.code}
              style={{
                backgroundColor: "#121214",
                marginBottom: 2,
                borderRadius: 8,
                position: "relative",
                overflow: "hidden",
                height: 64,
                display: "flex",
                alignItems: "center",
                paddingLeft: 16,
                paddingRight: 12,
              }}
            >
              {/* 左端カラーバー */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: 3.5,
                  height: "100%",
                  backgroundColor:
                    r.ret_1d !== null && r.ret_1d > 0
                      ? "#10B981"
                      : r.ret_1d !== null && r.ret_1d < 0
                      ? "#EF4444"
                      : "transparent",
                }}
              />

              {/* 左カラム 40% */}
              <div
                style={{
                  width: "40%",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "#F4F4F5",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.name}
                </div>
                <div style={{ fontSize: 11, color: "#71717A" }}>
                  <span
                    style={{
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      color: "#A1A1AA",
                      letterSpacing: "0.03em",
                    }}
                  >
                    {fmtCode(r.code)}
                  </span>
                  {" ・ "}
                  {fmtCap(r.mktcap_oku)}
                </div>
              </div>

              {/* 縦ディバイダ */}
              <div
                style={{
                  width: 1,
                  height: 32,
                  backgroundColor: "#1F1F23",
                  flexShrink: 0,
                  marginLeft: 8,
                  marginRight: 8,
                }}
              />

              {/* 中央カラム 20% */}
              <div
                style={{
                  width: "20%",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    ...darkColorStyle(r.ret_1d),
                  }}
                >
                  {pct(r.ret_1d)}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#E4E4E7",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {r.close !== null ? r.close.toLocaleString("ja-JP") : "-"}
                </div>
              </div>

              {/* 縦ディバイダ2: 中央-右間 */}
              <div
                style={{
                  width: 1,
                  height: 32,
                  backgroundColor: "#27272A",
                  flexShrink: 0,
                  marginLeft: 8,
                  marginRight: 8,
                }}
              />

              {/* 右カラム */}
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                }}
              >
                {/* 4列等幅グリッド：数値のみ */}
                <div style={matrixGridStyle}>
                  {(
                    [r.ret_5d, r.ret_1m, r.ret_3m, r.ret_1y] as (number | null)[]
                  ).map((v, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: 12,
                        fontFamily: "monospace",
                        fontVariantNumeric: "tabular-nums",
                        textAlign: "right",
                        ...darkColorStyle(v),
                      }}
                    >
                      {pct(v)}
                    </span>
                  ))}
                </div>
                {/* 出現:S高 */}
                <div style={{ textAlign: "right", width: "100%" }}>
                  <span style={{ fontSize: 10, color: "#71717A", fontFamily: "monospace" }}>
                    {t}:
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: s >= 1 ? 700 : 400,
                      fontFamily: "monospace",
                      color: s >= 1 ? "#F59E0B" : "#71717A",
                    }}
                  >
                    {s}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 除外銘柄注記 */}
      {excluded.length > 0 && (
        <div className="mt-8 pt-4" style={{ borderTop: "1px solid #1F1F23" }}>
          <p className="text-xs font-medium mb-1" style={{ color: "#71717A" }}>
            除外銘柄（手動）
          </p>
          <p className="text-[10px] mb-2" style={{ color: "#52525B" }}>
            以下は構造的ノイズとして一覧から除外中
          </p>
          {excluded.map((e) => (
            <div key={e.code} className="text-[10px] leading-5" style={{ color: "#52525B" }}>
              {e.code} {e.name} ― {e.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
