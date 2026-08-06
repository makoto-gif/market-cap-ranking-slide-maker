// スライド描画エンジン
// 1600x900 のデザイン座標系で描き、canvas の実サイズに合わせてスケールする。
const SLIDE_W = 1600;
const SLIDE_H = 900;
const JP_FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';

// cfg: {
//   title, subtitle, footnote,
//   startYear, endYear, showFuture, futureEndYear,
//   yAxisLabel, currentLabel,
//   series: [{ name, color, values: {year: number} }]  // 表示順は任意（内部で終了年の値で整列）
// }
function drawSlide(canvas, cfg) {
  const ctx = canvas.getContext("2d");
  const s = canvas.width / SLIDE_W;
  ctx.save();
  ctx.setTransform(s, 0, 0, s, 0, 0);

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

  // 未来ゾーン表示なしのときは右側に値ラベル分の余白を確保する
  const labelGutter = cfg.showFuture ? 0 : 110;
  const xOf = (year) => {
    const t = (year - cfg.startYear) / Math.max(1, lastAxisYear - cfg.startYear);
    return plot.left + t * (plot.right - labelGutter - plot.left);
  };

  // Y スケール（データ最大値からきりの良い目盛りを決める）
  let maxVal = 0;
  for (const sr of cfg.series) {
    for (let y = cfg.startYear; y <= cfg.endYear; y++) {
      const v = sr.values[y];
      if (v != null && v > maxVal) maxVal = v;
    }
  }
  if (maxVal <= 0) maxVal = 100;
  const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];
  let step = steps[steps.length - 1];
  for (const st of steps) {
    if (maxVal * 1.08 / st <= 7) { step = st; break; }
  }
  const yMax = Math.ceil((maxVal * 1.08) / step) * step;
  const yOf = (v) => plot.bottom - (v / yMax) * (plot.bottom - plot.top);

  // 未来ゾーン（薄い背景 + ? + キャッチコピー）
  const xNow = xOf(cfg.endYear);
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
    ctx.fillText("?", zcx, plot.top + 250);
    ctx.fillStyle = "#12263f";
    ctx.font = `bold 40px ${JP_FONT}`;
    ctx.fillText(cfg.futureTitle || "次の覇者は？", zcx, plot.top + 430);
    ctx.fillStyle = "#8a94a6";
    ctx.font = `24px ${JP_FONT}`;
    ctx.fillText(cfg.futureNote || "ここから先を読むことが重要", zcx, plot.top + 480);

    // 「現在」の破線と▼マーカー
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
    ctx.fillText(cfg.currentLabel, xNow, plot.top - 48);
    ctx.font = `18px ${JP_FONT}`;
    ctx.fillText("▼", xNow, plot.top - 24);
  }

  // 目盛り（横グリッドと Y 軸ラベル）
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let v = 0; v <= yMax; v += step) {
    const y = yOf(v);
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
  const ordered = [...cfg.series].sort((a, b) => (b.values[cfg.endYear] ?? -1) - (a.values[cfg.endYear] ?? -1));

  // 折れ線とマーカー
  for (const sr of ordered) {
    ctx.strokeStyle = sr.color;
    ctx.lineWidth = 3.5;
    ctx.lineJoin = "round";
    let started = false;
    ctx.beginPath();
    for (let y = cfg.startYear; y <= cfg.endYear; y++) {
      const v = sr.values[y];
      if (v == null) { started = false; continue; }
      const px = xOf(y), py = yOf(v);
      if (!started) { ctx.moveTo(px, py); started = true; }
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    for (let y = cfg.startYear; y <= cfg.endYear; y++) {
      const v = sr.values[y];
      if (v == null) continue;
      const px = xOf(y), py = yOf(v);
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
  const labeled = ordered.filter((sr) => sr.values[cfg.endYear] != null);
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
    ctx.fillStyle = lb.sr.color;
    ctx.font = `bold 26px ${JP_FONT}`;
    ctx.fillText(formatValue(lb.sr.values[cfg.endYear]), xNow + 26, lb.y);
  }

  // 凡例（左上・終了年の値の降順）
  const legendX = plot.left + 24;
  let legendY = plot.top + 22;
  const legendLine = ordered.length > 7 ? 30 : 36;
  const legendFont = ordered.length > 7 ? 22 : 25;
  ctx.textBaseline = "middle";
  for (const sr of ordered) {
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

function formatValue(v) {
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
