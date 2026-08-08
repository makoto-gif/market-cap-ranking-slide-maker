// スライド描画エンジン
// 1600x900 のデザイン座標系で描き、canvas の実サイズに合わせてスケールする。
const SLIDE_W = 1600;
const SLIDE_H = 900;
const JP_FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';

// cfg: {
//   title, subtitle, footnote,
//   startYear, endYear, showFuture, futureEndYear,
//   currentT,        // 最新値のX位置（例 2026.58 = 2026年8月）。endYearが最新年でない場合は null
//   currentLabel,    // 「現在（2026年8月6日）」など。null なら破線ラベルなし
//   showFutureCopy,  // 「次の覇者は？」などの文言を入れるか
//   unit: "usd" | "jpy" | "both",
//   yAxisLabel,
//   series: [{ name, color, values: {year: number} }]  // 値は10億USD
// }
function drawSlide(canvas, cfg) {
  const ctx = canvas.getContext("2d");
  const s = canvas.width / SLIDE_W;
  ctx.save();
  ctx.setTransform(s, 0, 0, s, 0, 0);

  // 軸・ラベルに使う単位変換（jpyモードは兆円、それ以外は10億USDのまま）
  const toUnit = (v) => (cfg.unit === "jpy" ? usdBToJpyT(v) : v);

  // 背景
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);

  // タイトル
  ctx.fillStyle = "#12263f";
  ctx.font = `bold 46px ${JP_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(cfg.title, SLIDE_W / 2, 62);

  // サブタイトル（左右に飾り線）
  ctx.font = `28px ${JP_FONT}`;
  ctx.fillStyle = "#33475b";
  const subW = ctx.measureText(cfg.subtitle).width;
  ctx.fillText(cfg.subtitle, SLIDE_W / 2, 118);
  ctx.strokeStyle = "#e8a960";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(SLIDE_W / 2 - subW / 2 - 90, 118);
  ctx.lineTo(SLIDE_W / 2 - subW / 2 - 20, 118);
  ctx.moveTo(SLIDE_W / 2 + subW / 2 + 20, 118);
  ctx.lineTo(SLIDE_W / 2 + subW / 2 + 90, 118);
  ctx.stroke();

  // プロット領域
  const plot = { left: 120, right: 1540, top: 195, bottom: 820 };
  const axisYears = [];
  const lastAxisYear = cfg.showFuture ? cfg.futureEndYear : cfg.endYear;
  for (let y = cfg.startYear; y <= lastAxisYear; y++) axisYears.push(y);

  // 各社の描画点列（月次履歴があれば月単位、なければ年次）
  const drawSeries = cfg.series.map((sr) => ({
    sr,
    ...seriesDrawPoints(sr, cfg.startYear, cfg.endYear, cfg.granularity)
  }));
  const lineEndX = Math.max(cfg.endYear, ...drawSeries.map((d) => d.endX));

  // 未来ゾーン表示なしのときは右側に値ラベル分の余白を確保する
  const labelGutter = cfg.showFuture ? 0 : (cfg.unit === "both" ? 230 : 130);
  const xSpanEnd = cfg.showFuture ? lastAxisYear : lineEndX;
  const xOf = (t) => {
    const denom = Math.max(0.5, xSpanEnd - cfg.startYear);
    return plot.left + ((t - cfg.startYear) / denom) * (plot.right - labelGutter - plot.left);
  };

  const xNow = xOf(lineEndX);

  // Y スケール（表示単位でのデータ最大値からきりの良い目盛りを決める）
  let maxVal = 0;
  for (const d of drawSeries) {
    for (const p of d.pts) {
      if (toUnit(p.v) > maxVal) maxVal = toUnit(p.v);
    }
  }
  if (maxVal <= 0) maxVal = 100;
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];
  let step = steps[steps.length - 1];
  for (const st of steps) {
    if (maxVal * 1.08 / st <= 7) { step = st; break; }
  }
  const yMax = Math.ceil((maxVal * 1.08) / step) * step;
  const yOf = (v) => plot.bottom - (toUnit(v) / yMax) * (plot.bottom - plot.top);

  // 未来ゾーン（薄い背景 + ? + キャッチコピー）
  if (cfg.showFuture) {
    const zx = xNow + 14;
    const zw = plot.right - zx;
    ctx.fillStyle = "#eef1f7";
    roundRect(ctx, zx, plot.top - 20, zw, plot.bottom - plot.top + 20, 18);
    ctx.fill();

    const zcx = zx + zw / 2;
    ctx.fillStyle = "#c4ccdd";
    ctx.font = `bold 230px ${JP_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("?", zcx, plot.top + (cfg.showFutureCopy ? 250 : 300));
    if (cfg.showFutureCopy) {
      ctx.fillStyle = "#12263f";
      ctx.font = `bold 40px ${JP_FONT}`;
      ctx.fillText("次の覇者は？", zcx, plot.top + 430);
      ctx.fillStyle = "#8a94a6";
      ctx.font = `24px ${JP_FONT}`;
      ctx.fillText("ここから先を読むことが重要", zcx, plot.top + 480);
    }
  }

  // 「現在」の破線と▼マーカー（未来ゾーンの有無に関わらず表示）
  if (cfg.currentLabel) {
    ctx.strokeStyle = "#5b6472";
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(xNow, plot.top - 12);
    ctx.lineTo(xNow, plot.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#12263f";
    ctx.font = `bold 24px ${JP_FONT}`;
    ctx.textAlign = "center";
    const labelW = ctx.measureText(cfg.currentLabel).width;
    const labelX = Math.max(plot.left + labelW / 2, Math.min(xNow, plot.right - labelW / 2));
    ctx.fillText(cfg.currentLabel, labelX, plot.top - 48);
    ctx.font = `18px ${JP_FONT}`;
    ctx.fillText("▼", xNow, plot.top - 24);
  }

  // 目盛り（横グリッドと Y 軸ラベル）
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let v = 0; v <= yMax; v += step) {
    const y = plot.bottom - (v / yMax) * (plot.bottom - plot.top);
    ctx.strokeStyle = v === 0 ? "#9aa4b2" : "#e6e9ef";
    ctx.lineWidth = v === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.right, y);
    ctx.stroke();
    ctx.fillStyle = "#5b6472";
    ctx.font = `22px ${JP_FONT}`;
    ctx.fillText(formatValue(v), plot.left - 12, y);
  }

  // X 軸（年ラベル）
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#5b6472";
  ctx.font = `22px ${JP_FONT}`;
  const skip = axisYears.length > 16 ? 2 : 1;
  for (const year of axisYears) {
    if ((year - cfg.startYear) % skip !== 0) continue;
    ctx.fillText(String(year), xOf(year), plot.bottom + 14);
  }

  // Y 軸タイトル（縦書き回転）
  ctx.save();
  ctx.translate(38, (plot.top + plot.bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#33475b";
  ctx.font = `24px ${JP_FONT}`;
  ctx.fillText(cfg.yAxisLabel, 0, 0);
  ctx.restore();

  // 終了年の値で降順に整列（凡例・値ラベルの順序に使用）
  const ordered = [...drawSeries].sort(
    (a, b) => (b.sr.values[cfg.endYear] ?? -1) - (a.sr.values[cfg.endYear] ?? -1)
  );

  // 折れ線とマーカー
  for (const d of ordered) {
    const { sr, pts, mode } = d;
    ctx.strokeStyle = sr.color;
    ctx.lineWidth = mode === "d" ? 2.2 : mode === "m" ? 3 : 3.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let started = false;
    let prevP = null;
    for (const p of pts) {
      const px = xOf(p.x), py = yOf(p.v);
      if (!started || (prevP != null && !segOk(prevP, p))) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
      prevP = p;
    }
    ctx.stroke();

    // マーカーは年区切りの点と先端のみ（年次モードは全点が対象）
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!p.mark && i !== pts.length - 1) continue;
      const px = xOf(p.x), py = yOf(p.v);
      ctx.fillStyle = sr.color;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 最新値ラベル（重なりを避けて上下に押し広げる）
  const labeled = ordered.map((d) => d.sr).filter((sr) => sr.values[cfg.endYear] != null);
  const minGap = 30;
  const labels = labeled
    .map((sr) => ({ sr, y: yOf(sr.values[cfg.endYear]) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 0; i < labels.length; i++) {
    if (i > 0 && labels[i].y < labels[i - 1].y + minGap) labels[i].y = labels[i - 1].y + minGap;
  }
  for (let i = labels.length - 1; i >= 0; i--) {
    const maxY = plot.bottom - 10 - (labels.length - 1 - i) * minGap;
    if (labels[i].y > maxY) labels[i].y = maxY;
    if (i < labels.length - 1 && labels[i].y > labels[i + 1].y - minGap) labels[i].y = labels[i + 1].y - minGap;
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const lb of labels) {
    const v = lb.sr.values[cfg.endYear];
    ctx.fillStyle = lb.sr.color;
    ctx.font = `bold ${cfg.unit === "both" ? 24 : 26}px ${JP_FONT}`;
    ctx.fillText(formatSlideValue(v, cfg.unit), xNow + 26, lb.y);
  }

  // 凡例（左上・終了年の値の降順）
  const legendX = plot.left + 24;
  let legendY = plot.top + 22;
  const legendLine = ordered.length > 7 ? 30 : 36;
  const legendFont = ordered.length > 7 ? 22 : 25;
  ctx.textBaseline = "middle";
  for (const { sr } of ordered) {
    ctx.strokeStyle = sr.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(legendX, legendY);
    ctx.lineTo(legendX + 16, legendY);
    ctx.moveTo(legendX + 28, legendY);
    ctx.lineTo(legendX + 44, legendY);
    ctx.stroke();
    ctx.fillStyle = sr.color;
    ctx.beginPath();
    ctx.arc(legendX + 22, legendY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#33475b";
    ctx.font = `${legendFont}px ${JP_FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(sr.name, legendX + 56, legendY + 1);
    legendY += legendLine;
  }

  // 脚注
  ctx.fillStyle = "#8a94a6";
  ctx.font = `20px ${JP_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(cfg.footnote, plot.left, 868);

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// スライド上の最新値ラベル（単位モード別、v は10億USD）
function formatSlideValue(v, unit) {
  if (unit === "jpy") return `${formatJpyT(v)}兆円`;
  if (unit === "both") return `${formatValue(v)}（${formatJpyT(v)}兆円）`;
  return formatValue(v);
}
