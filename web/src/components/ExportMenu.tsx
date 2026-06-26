"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  sanitize4digit,
  buildSbiCsv,
  buildRakutenCsv,
  buildTradingViewText,
  downloadCsv,
  todayYMD,
} from "@/lib/exportStocks";

// モジュール外で定義することで subscribe/snapshot が安定した参照になる
const mqSubscribe = (cb: () => void) => {
  const mq = window.matchMedia("(max-width: 767px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const mqSnapshot = () => window.matchMedia("(max-width: 767px)").matches;
const mqServerSnapshot = () => false;

const monoFont =
  '"SF Mono",SFMono-Regular,ui-monospace,"Roboto Mono",Menlo,Consolas,monospace';
const MENU_BG = "#2c2c2e";
const MENU_BORDER = "#3a3a3c";
const MENU_TEXT = "#e8eaed";
const MENU_TEXT_SUB = "#8e8e93";

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 9h-4V3H9v6H5l7 7 7-7zm-8 2V5h2v6h1.17L12 13.17 9.83 11H11zm-6 7h14v2H5z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
    </svg>
  );
}

type Props = {
  codes: string[];
};

export default function ExportMenu({ codes }: Props) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(false);
  const isMobile = useSyncExternalStore(mqSubscribe, mqSnapshot, mqServerSnapshot);
  const wrapRef = useRef<HTMLDivElement>(null);

  // デスクトップ: ラッパー外クリックで閉じる
  useEffect(() => {
    if (!open || isMobile) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, isMobile]);

  const codes4 = sanitize4digit(codes);

  const handleSbi = () => {
    downloadCsv(buildSbiCsv(codes4), `sbi_${todayYMD()}.csv`);
    setOpen(false);
  };

  const handleRakuten = () => {
    downloadCsv(buildRakutenCsv(codes4), `rakuten_${todayYMD()}.csv`);
    setOpen(false);
  };

  const handleTV = async () => {
    try {
      await navigator.clipboard.writeText(buildTradingViewText(codes4));
      setOpen(false);
      setToast(true);
      setTimeout(() => setToast(false), 2200);
    } catch {
      setOpen(false);
    }
  };

  const menuItems = [
    {
      label: "SBI証券",
      sublabel: "CSVダウンロード",
      icon: <DownloadIcon />,
      onClick: handleSbi,
    },
    {
      label: "楽天証券",
      sublabel: "CSVダウンロード",
      icon: <DownloadIcon />,
      onClick: handleRakuten,
    },
    {
      label: "TradingView",
      sublabel: "クリップボードにコピー",
      icon: <CopyIcon />,
      onClick: handleTV,
    },
  ];

  return (
    <>
      <div ref={wrapRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            background: "#282a2d",
            border: "1px solid #3c4043",
            color: "#8e8e93",
            cursor: "pointer",
            fontFamily: monoFont,
          }}
        >
          出力
        </button>

        {/* デスクトップ: 上方向ポップオーバー */}
        {open && !isMobile && (
          <div
            style={{
              position: "absolute",
              right: 0,
              bottom: "calc(100% + 6px)",
              background: MENU_BG,
              border: `1px solid ${MENU_BORDER}`,
              borderRadius: 10,
              overflow: "hidden",
              minWidth: 210,
              boxShadow: "0 4px 20px rgba(0,0,0,0.55)",
              zIndex: 100,
            }}
          >
            {menuItems.map((item, idx) => (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "12px 16px",
                  background: "transparent",
                  border: "none",
                  borderTop: idx > 0 ? `1px solid ${MENU_BORDER}` : "none",
                  color: MENU_TEXT,
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: monoFont,
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#3a3a3c")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <span style={{ color: MENU_TEXT_SUB, flexShrink: 0 }}>
                  {item.icon}
                </span>
                <span>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {item.label}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: MENU_TEXT_SUB,
                      marginTop: 2,
                    }}
                  >
                    {item.sublabel}
                  </div>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* モバイル: ボトムシート（position:fixed はposition:relativeの親でも機能する） */}
        {open && isMobile && (
          <>
            <div
              onClick={() => setOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.5)",
                zIndex: 200,
              }}
            />
            <div
              style={{
                position: "fixed",
                left: 0,
                right: 0,
                bottom: 0,
                background: MENU_BG,
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                zIndex: 201,
                paddingBottom: "env(safe-area-inset-bottom, 0px)",
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 4,
                  background: "#555",
                  borderRadius: 2,
                  margin: "10px auto 4px",
                }}
              />
              {menuItems.map((item, idx) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={item.onClick}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    width: "100%",
                    padding: "16px 20px",
                    background: "transparent",
                    border: "none",
                    borderTop: idx > 0 ? `1px solid ${MENU_BORDER}` : "none",
                    color: MENU_TEXT,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: monoFont,
                  }}
                >
                  <span style={{ color: MENU_TEXT_SUB, flexShrink: 0 }}>
                    {item.icon}
                  </span>
                  <span>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>
                      {item.label}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: MENU_TEXT_SUB,
                        marginTop: 2,
                      }}
                    >
                      {item.sublabel}
                    </div>
                  </span>
                </button>
              ))}
              <div style={{ height: 8 }} />
            </div>
          </>
        )}
      </div>

      {/* トースト（open=falseの後に表示されるため干渉しない） */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 80,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#323232",
            color: "#e8eaed",
            fontSize: 13,
            fontFamily: monoFont,
            padding: "10px 20px",
            borderRadius: 20,
            zIndex: 300,
            boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          コピーしました
        </div>
      )}
    </>
  );
}
