"use client";

const monoFont = '"SF Mono",SFMono-Regular,ui-monospace,"Roboto Mono",Menlo,Consolas,monospace';

// 判断ログ(Phase5): 文面は仕様書の指定通り一字一句そのまま(語順・記号・改行の
// 折り返しのみ結合)。改行はtxtファイルの折り返し由来と判断し、段落内では詰めた。
const GLOSSARY: { term: string; body: string }[] = [
  {
    term: "tier(区分)",
    body: "局面内の累積超過リターンを、その日の母集団内で相対順位により3等分したもの(high/mid/low)。絶対基準ではないため、全体がマイナスの日でもhighは存在する。検証でhigh 63% > mid 50% > low 33%の再ブレイク率勾配を確認済み。",
  },
  {
    term: "超過収益(cum_excess_return)",
    body: "局面開始前日から当日までの累積騰落率から、同期間の日経225の累積騰落率を引いた値。局面中に指数よりどれだけ強かったか。",
  },
  {
    term: "強日数(strong_day_count)",
    body: "局面内の暴落トリガー日(単日急落日)のうち、日次騰落率が指数を上回った日数。「n/m」のmは局面の暴落トリガー日総数。暴落の瞬間に踏ん張れているかを示す。",
  },
  {
    term: "逆行★",
    body: "超過収益がプラス(指数に対し絶対的に勝っている)銘柄。tierは相対順位のため、この★の有無で絶対的な強さを確認できる。",
  },
  {
    term: "距離(dist_to_high)",
    body: "暴落前高値まであと何%か(暴落前高値÷現在値−1)。暴落前高値は局面開始直前20営業日の高値(High)の最大値。",
  },
  {
    term: "セクション",
    body: "S=暴落前高値を局面中に一度でも奪回済み / A=tier highかつ距離15%以内(検証で奪回率69%の最良セル) / B=tier highで距離15%超、またはtier midで距離15%以内 / C=tier midの残り / D=tier low全て(目視判断用に非表示にせず全掲載)。",
  },
  {
    term: "大型耐性ピック",
    body: "時価総額3000億円以上・暴落トリガー日の6割以上で指数超え・未奪回の銘柄。累積超過ソートでは浮かない「ジワ耐えしている大型」の先回り抽出枠。",
  },
  {
    term: "上昇率(top_ret)",
    body: "年初来上昇率と120営業日前比上昇率の大きい方。局面開始前日時点で計算した「暴落前の事前上昇率」。母集団の選定条件(50%以上)に使用。",
  },
  {
    term: "ma25乖離",
    body: "局面開始前日時点の25日移動平均からの終値乖離率。現在時点の値ではない点に注意。",
  },
  {
    term: "時価総額",
    body: "当日終値×発行済株式数(分割調整済み)。",
  },
];

// 判断ログ(Phase5): Phase4のChartModalと同じposition:fixed; inset:0の
// フルスクリーンオーバーレイパターンを流用(iOS Safari対応実績のあるパターン)。
export default function GlossaryModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        zIndex: 500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight: "85vh",
          overflowY: "auto",
          background: "#1c1c1f",
          border: "1px solid #2a2d34",
          borderRadius: 10,
          padding: "16px 16px 20px",
          fontFamily: monoFont,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e8eaed", marginBottom: 12 }}>
          用語解説
        </div>
        {GLOSSARY.map((g) => (
          <div key={g.term} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#e8eaed", marginBottom: 2 }}>
              {g.term}
            </div>
            <div style={{ fontSize: 11, color: "#8a8a8e", lineHeight: 1.6 }}>
              {g.body}
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          zIndex: 501,
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: "none",
          background: "#2c2c2e",
          color: "#e8eaed",
          fontSize: 18,
          lineHeight: "36px",
          textAlign: "center",
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        }}
      >
        ×
      </button>
    </div>
  );
}
