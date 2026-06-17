"use client";
import { useEffect, useState } from "react";

type Row = {
  code: string;
  name: string;
  turnover_pct: number;
  ret_1d: number | null;
  ret_5d: number | null;
  ret_1m: number | null;
  ret_3m: number | null;
};

function pct(v: number | null): string {
  return v === null || v === undefined ? "-" : v.toFixed(1) + "%";
}
function colorOf(v: number | null): string {
  if (v === null || v === undefined) return "text-gray-400";
  if (v > 0) return "text-green-600";
  if (v < 0) return "text-red-600";
  return "text-gray-600";
}

export default function Home() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/ranking.json")
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((d) => {
        setMeta(d._meta);
        setRows(d.ranking.slice(0, 30));
      })
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <pre className="p-4 text-red-600">ERROR: {err}</pre>;
  if (!rows) return <div className="p-4">loading...</div>;

  const headers = ["銘柄", "1d", "5d", "1m", "3m", "回転率", "人気", "初", "信"];

  return (
    <div className="p-3">
      <h1 className="text-base font-bold mb-1">今日の資金流入（回転率）</h1>
      <p className="text-xs text-gray-500 mb-3">
        {meta?.date} ／ 上位30件
      </p>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="border-b border-gray-300 text-gray-600">
              {headers.map((h) => (
                <th key={h} className="px-2 py-1 text-right whitespace-nowrap first:text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-b border-gray-100">
                <td className="px-2 py-1 text-left whitespace-nowrap">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-[10px] text-gray-400">{r.code}</div>
                </td>
                <td className={"px-2 py-1 text-right " + colorOf(r.ret_1d)}>{pct(r.ret_1d)}</td>
                <td className={"px-2 py-1 text-right " + colorOf(r.ret_5d)}>{pct(r.ret_5d)}</td>
                <td className={"px-2 py-1 text-right " + colorOf(r.ret_1m)}>{pct(r.ret_1m)}</td>
                <td className={"px-2 py-1 text-right " + colorOf(r.ret_3m)}>{pct(r.ret_3m)}</td>
                <td className="px-2 py-1 text-right font-medium">{r.turnover_pct.toFixed(1)}%</td>
                <td className="px-2 py-1 text-right text-gray-400">-</td>
                <td className="px-2 py-1 text-right text-gray-400">-</td>
                <td className="px-2 py-1 text-right text-gray-400">-</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
