import type {
  IChartApiBase,
  IPanePrimitive,
  IPanePrimitivePaneView,
  IPrimitivePaneRenderer,
  PaneAttachedParameter,
  Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

// 判断ログ(crashチャートUI変更): 暴落局面の注釈(開始日の縦線/暴落日の背景帯)は
// 特定の日付にだけ描く必要があり、既存のcandleSeries markers(点)や
// 固定間隔のgridLinesでは表現できないため、lightweight-charts v5のpane primitive
// (chart.panes()[i].attachPrimitive)で自前描画する。他画面のChartCard利用箇所に
// 影響を出さないため、ChartExtraMarkerと同様にopt-inの追加propとして実装する。
export type ChartPhaseAnnotation = {
  /** 赤の縦点線を引く日('YYYY-MM-DD')。data.rowsに無い日付は無視される */
  startDate: string;
  /** 背景を薄いグレー帯にする日('YYYY-MM-DD')。data.rowsに無い日付は無視される */
  bandDates: string[];
};

const LINE_COLOR = "#E03A2F";
const BAND_COLOR = "rgba(120,130,150,0.16)";

function coordinateAt(chart: IChartApiBase<Time>, date: string): number | null {
  return chart.timeScale().timeToCoordinate(date as Time);
}

// 隣接バーとの座標差からバー1本分の幅を推定する(リサイズ後の再描画でも追従する)
function barWidthAt(chart: IChartApiBase<Time>, allDates: string[], date: string): number | null {
  const idx = allDates.indexOf(date);
  if (idx === -1) return null;
  const x = coordinateAt(chart, date);
  if (x === null) return null;
  const nextX = idx < allDates.length - 1 ? coordinateAt(chart, allDates[idx + 1]) : null;
  if (nextX !== null) return Math.abs(nextX - x);
  const prevX = idx > 0 ? coordinateAt(chart, allDates[idx - 1]) : null;
  if (prevX !== null) return Math.abs(x - prevX);
  return null;
}

class PhaseBandPaneView implements IPanePrimitivePaneView {
  constructor(private _primitive: ChartPhasePrimitive) {}

  zOrder(): "bottom" {
    return "bottom";
  }

  renderer(): IPrimitivePaneRenderer {
    const primitive = this._primitive;
    return {
      draw: () => {},
      drawBackground: (target: CanvasRenderingTarget2D) => {
        const chart = primitive.chart;
        if (!chart) return;
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          for (const date of primitive.bandDates) {
            const x = coordinateAt(chart, date);
            const w = barWidthAt(chart, primitive.allDates, date);
            if (x === null || w === null) continue;
            ctx.fillStyle = BAND_COLOR;
            ctx.fillRect(x - w / 2, 0, w, mediaSize.height);
          }
        });
      },
    };
  }
}

class PhaseLinePaneView implements IPanePrimitivePaneView {
  constructor(private _primitive: ChartPhasePrimitive) {}

  zOrder(): "top" {
    return "top";
  }

  renderer(): IPrimitivePaneRenderer {
    const primitive = this._primitive;
    return {
      draw: (target: CanvasRenderingTarget2D) => {
        const chart = primitive.chart;
        if (!chart || primitive.startDate === null) return;
        const x = coordinateAt(chart, primitive.startDate);
        if (x === null) return;
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          ctx.save();
          ctx.strokeStyle = LINE_COLOR;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, 0);
          ctx.lineTo(Math.round(x) + 0.5, mediaSize.height);
          ctx.stroke();
          ctx.restore();
        });
      },
    };
  }
}

export class ChartPhasePrimitive implements IPanePrimitive<Time> {
  chart: IChartApiBase<Time> | null = null;
  allDates: string[];
  startDate: string | null;
  bandDates: string[];

  private _bandView = new PhaseBandPaneView(this);
  private _lineView = new PhaseLinePaneView(this);

  constructor(allDates: string[], annotation: ChartPhaseAnnotation) {
    this.allDates = allDates;
    const dateSet = new Set(allDates);
    this.startDate = dateSet.has(annotation.startDate) ? annotation.startDate : null;
    this.bandDates = annotation.bandDates.filter((d) => dateSet.has(d));
  }

  attached(param: PaneAttachedParameter<Time>): void {
    this.chart = param.chart;
  }

  detached(): void {
    this.chart = null;
  }

  paneViews(): readonly IPanePrimitivePaneView[] {
    return [this._bandView, this._lineView];
  }
}
