// ランキング推移ビュー: 再生アニメーション付きチャートとランキングバー
const vstate = {
  market: "japan",
  mode: "top",
  topN: 5,
  selectedIds: { japan: [], world: [] },
  startYear: YEARS[0],
  endYear: LATEST_YEAR,
  unit: "usd",       // "usd" | "jpy"
  granularity: "auto", // "auto" | "daily" | "monthly" | "yearly"
  t: null,           // 現在の再生位置（年、小数）。null なら末尾
  playing: false
};

const vels = {};
let barPositions = {};   // id -> 現在のY位置（順位入れ替えのアニメーション用）
let lastFrame = null;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

document.addEventListener("DOMContentLoaded", () => {
  ["marketToggle", "modeToggle", "topNRow", "topN", "companyListRow", "companyList",
   "resetCompanies", "startYear", "endYear", "unitToggle", "granToggle", "playBtn",
   "timeSlider", "timeLabel", "lineCanvas", "barCanvas", "dataBadge", "tooltip"
  ].forEach((id) => { vels[id] = document.getElementById(id); });

  for (const y of YEARS) {
    vels.startYear.add(new Option(`${y}年`, y));
    vels.endYear.add(new Option(`${y}年`, y));
  }
  vels.startYear.value = vstate.startYear;
  vels.endYear.value = vstate.endYear;

  vels.marketToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-market]");
    if (!btn) return;
    vstate.market = btn.dataset.market;
    buildCompanyList();
    resetTimeline();
  });
  vels.modeToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mode]");
    if (!btn) return;
    vstate.mode = btn.dataset.mode;
    syncControls();
    draw();
  });
  vels.unitToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-unit]");
    if (!btn) return;
    vstate.unit = btn.dataset.unit;
    syncControls();
    draw();
  });
  vels.granToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-gran]");
    if (!btn) return;
    vstate.granularity = btn.dataset.gran;
    syncControls();
    draw();
  });
  vels.topN.addEventListener("change", () => { vstate.topN = Number(vels.topN.value); draw(); });
  vels.startYear.addEventListener("change", onYearChange);
  vels.endYear.addEventListener("change", onYearChange);

  vels.playBtn.addEventListener("click", togglePlay);
  vels.timeSlider.addEventListener("input", () => {
    vstate.playing = false;
    const [t0, t1] = timeDomain();
    vstate.t = t0 + (Number(vels.timeSlider.value) / 1000) * (t1 - t0);
    syncControls();
    draw();
  });

  vels.lineCanvas.addEventListener("mousemove", onHover);
  vels.lineCanvas.addEventListener("mouseleave", () => { vels.tooltip.hidden = true; });

  window.addEventListener("resize", draw);

  buildCompanyList();
  resetTimeline();
  requestAnimationFrame(tick);
  latestReady.then(() => { buildCompanyList(); resetTimeline(); });
});

function onYearChange() {
  let s = Number(vels.startYear.value);
  let e = Number(vels.endYear.value);
  if (s >= e) {
    if (document.activeElement === vels.startYear) e = Math.min(LATEST_YEAR, s + 1);
    else s = Math.max(YEARS[0], e - 1);
    vels.startYear.value = s;
    vels.endYear.value = e;
  }
  vstate.startYear = s;
  vstate.endYear = e;
  resetTimeline();
}

function timeDomain() {
  const end = vstate.endYear === LATEST_YEAR ? currentFractionalYear() : vstate.endYear;
  return [vstate.startYear, end];
}

function resetTimeline() {
  const [, t1] = timeDomain();
  vstate.t = t1;
  vstate.playing = false;
  barPositions = {};
  syncControls();
  draw();
}

function togglePlay() {
  const [t0, t1] = timeDomain();
  if (!vstate.playing) {
    // 末尾で再生を押したら最初から
    if (vstate.t == null || vstate.t >= t1 - 0.02) vstate.t = t0;
    vstate.playing = true;
  } else {
    vstate.playing = false;
  }
  syncControls();
}

function tick(now) {
  const dt = lastFrame == null ? 0 : Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  if (vstate.playing) {
    const [t0, t1] = timeDomain();
    const speed = reducedMotion ? (t1 - t0) : (t1 - t0) / 8; // 8秒で全期間（reduce時は即座）
    vstate.t = Math.min(t1, vstate.t + speed * dt);
    if (vstate.t >= t1) vstate.playing = false;
    syncControls();
    draw();
  } else {
    // バーの位置がまだ動いている間は描画を続ける
    if (drawBars(true)) drawBars(false);
  }
  requestAnimationFrame(tick);
}

function syncControls() {
  for (const btn of vels.marketToggle.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.market === vstate.market);
  }
  for (const btn of vels.modeToggle.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.mode === vstate.mode);
  }
  for (const btn of vels.unitToggle.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.unit === vstate.unit);
  }
  for (const btn of vels.granToggle.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.gran === vstate.granularity);
  }
  vels.topNRow.hidden = vstate.mode !== "top";
  vels.companyListRow.hidden = vstate.mode !== "custom";
  vels.playBtn.textContent = vstate.playing ? "⏸ 一時停止" : "▶ 再生";

  const [t0, t1] = timeDomain();
  const t = vstate.t == null ? t1 : vstate.t;
  vels.timeSlider.value = Math.round(((t - t0) / Math.max(0.001, t1 - t0)) * 1000);
  vels.timeLabel.textContent = timeText(t, t1);
  vels.dataBadge.textContent = LATEST_META.live
    ? `最新データ: ${latestDateText()}時点（毎日自動更新）`
    : `同梱データ: ${latestDateText()}時点`;
}

// 再生位置の年月表示。末尾（最新時点）は日付まで表示する。
// 月次データがあるときは実データの月、なければ補間なので「ごろ」を付ける。
function timeText(t, t1) {
  if (vstate.endYear === LATEST_YEAR && t >= t1 - 0.001) return `${latestDateText()}時点`;
  const fine = HAS_MONTHLY || HAS_DAILY;
  const year = Math.floor(t + 1e-6);
  const month = Math.min(12, Math.max(1, Math.round((t - year) * 12) + 1));
  if (!fine && t - year < 1 / 24) return `${year}年`;
  return `${year}年${month}月${fine ? "" : "ごろ"}`;
}

function buildCompanyList() {
  const { companies } = MARKET_DATA[vstate.market];
  vels.companyList.innerHTML = "";
  const selected = vstate.selectedIds[vstate.market];
  for (const c of companies) {
    const label = document.createElement("label");
    label.className = "company-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = c.id;
    cb.checked = selected.includes(c.id);
    cb.addEventListener("change", () => {
      const arr = vstate.selectedIds[vstate.market];
      if (cb.checked) { if (!arr.includes(c.id)) arr.push(c.id); }
      else { vstate.selectedIds[vstate.market] = arr.filter((id) => id !== c.id); }
      draw();
    });
    const dot = document.createElement("span");
    dot.className = "color-dot";
    dot.style.background = c.color;
    label.append(cb, dot, document.createTextNode(c.name));
    vels.companyList.appendChild(label);
  }
  vels.resetCompanies.onclick = () => {
    vstate.selectedIds[vstate.market] = [];
    buildCompanyList();
    draw();
  };
}

function displayedSeries() {
  const { companies } = MARKET_DATA[vstate.market];
  if (vstate.mode === "custom" && vstate.selectedIds[vstate.market].length > 0) {
    return companies.filter((c) => vstate.selectedIds[vstate.market].includes(c.id));
  }
  return [...companies]
    .filter((c) => c.values[vstate.endYear] != null)
    .sort((a, b) => b.values[vstate.endYear] - a.values[vstate.endYear])
    .slice(0, vstate.topN);
}

// 各社の折れ線上の点列（選択した粒度に応じて日次/月次/年次）
function seriesPoints(c) {
  return seriesDrawPoints(c, vstate.startYear, vstate.endYear, vstate.granularity);
}

// 時点 t における補間値（データがない区間は null）
function valueAt(c, t) {
  const { pts } = seriesPoints(c);
  if (pts.length === 0) return null;
  if (t <= pts[0].x) return t >= pts[0].x - 1e-6 ? pts[0].v : null;
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].x + 1e-6) {
      // 連続した点でなければ（欠測区間）null。ただし末尾の「現在」点への接続は許可
      if (!segOk(pts[i - 1], pts[i])) return null;
      const gap = pts[i].x - pts[i - 1].x;
      const r = (t - pts[i - 1].x) / gap;
      return pts[i - 1].v + (pts[i].v - pts[i - 1].v) * r;
    }
  }
  // 点列の末尾より少し先（最新時点との誤差）は末尾の値
  if (t - pts[pts.length - 1].x < 1 / 12) return pts[pts.length - 1].v;
  return null;
}

const toU = (v) => (vstate.unit === "jpy" ? usdBToJpyT(v) : v);
const fmtBoth = (v) => `$${formatValue(v)}B｜${formatJpyT(v)}兆円`;
const fmtU = (v) => (vstate.unit === "jpy" ? `${formatJpyT(v)}兆円` : `$${formatValue(v)}B`);

// ---- 折れ線チャート ----
let lineLayout = null; // ホバー用に座標系を保存

function draw() {
  drawLine();
  drawBars(false);
}

function drawLine() {
  const canvas = vels.lineCanvas;
  const cssW = canvas.parentElement.clientWidth - 32;
  const cssH = Math.max(300, Math.min(430, cssW * 0.4));
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const styles = getComputedStyle(document.documentElement);
  const cText = styles.getPropertyValue("--text").trim() || "#12263f";
  const cMuted = styles.getPropertyValue("--muted").trim() || "#5b6472";
  const cGrid = styles.getPropertyValue("--border-light").trim() || "#e6e9ef";

  const [t0, t1] = timeDomain();
  const t = vstate.t == null ? t1 : vstate.t;
  const series = displayedSeries();

  const plot = { left: 64, right: cssW - 96, top: 18, bottom: cssH - 34 };
  const xOf = (x) => plot.left + ((x - t0) / Math.max(0.5, t1 - t0)) * (plot.right - plot.left);

  let maxVal = 0;
  for (const c of series) {
    for (const p of seriesPoints(c).pts) { if (toU(p.v) > maxVal) maxVal = toU(p.v); }
  }
  if (maxVal <= 0) maxVal = 100;
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000];
  let step = steps[steps.length - 1];
  for (const st of steps) { if (maxVal * 1.06 / st <= 6) { step = st; break; } }
  const yMax = Math.ceil((maxVal * 1.06) / step) * step;
  const yOf = (v) => plot.bottom - (toU(v) / yMax) * (plot.bottom - plot.top);

  ctx.clearRect(0, 0, cssW, cssH);

  // グリッドとY軸
  const fontBase = '12px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let v = 0; v <= yMax; v += step) {
    const y = plot.bottom - (v / yMax) * (plot.bottom - plot.top);
    ctx.strokeStyle = cGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.right, y);
    ctx.stroke();
    ctx.fillStyle = cMuted;
    ctx.font = fontBase;
    ctx.fillText(formatValue(v), plot.left - 8, y);
  }

  // X軸（年）
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = cMuted;
  ctx.font = fontBase;
  const span = Math.ceil(t1) - t0;
  const skip = span > 8 && cssW < 700 ? 2 : 1;
  for (let y = t0; y <= Math.floor(t1); y++) {
    if ((y - t0) % skip !== 0) continue;
    ctx.fillText(String(y), xOf(y), plot.bottom + 8);
  }

  // 「現在」破線（最新年まで表示しているときのみ）
  if (vstate.endYear === LATEST_YEAR) {
    const xN = xOf(t1);
    ctx.strokeStyle = cMuted;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xN, plot.top);
    ctx.lineTo(xN, plot.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 折れ線（t まで描画）とツールチップ用の候補点
  const candMap = new Map();
  for (const c of series) {
    const { pts: allPts, mode } = seriesPoints(c);
    const pts = allPts.filter((p) => p.x <= t + 1e-6);
    for (const p of allPts) {
      const key = Math.round(p.x * 4000);
      if (!candMap.has(key)) candMap.set(key, { x: p.x, label: p.label });
    }
    const vNow = valueAt(c, t);
    ctx.strokeStyle = c.color;
    ctx.lineWidth = mode === "d" ? 1.6 : 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let started = false;
    let prevP = null;
    for (const p of pts) {
      const px = xOf(p.x), py = yOf(p.v);
      if (!started || (prevP != null && !segOk(prevP, p))) { ctx.moveTo(px, py); started = true; }
      else ctx.lineTo(px, py);
      prevP = p;
    }
    // t が点と点の間なら先端まで補間して伸ばす（欠測区間なら vNow が null なので伸びない）
    if (vNow != null && pts.length > 0 && t > pts[pts.length - 1].x + 1e-6) {
      ctx.lineTo(xOf(t), yOf(vNow));
    }
    ctx.stroke();

    // マーカー（年区切りの点のみ）と先端の強調点
    for (const p of pts) {
      if (!p.mark) continue;
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(xOf(p.x), yOf(p.v), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    if (vNow != null) {
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(xOf(t), yOf(vNow), 5.5, 0, Math.PI * 2);
      ctx.fill();
      // 先端の直接ラベル（社名）
      ctx.font = fontBase;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(c.name, xOf(t) + 9, yOf(vNow));
    }
  }

  const cands = [...candMap.values()].sort((a, b) => a.x - b.x);
  lineLayout = { plot, t0, t1, xOf, yOf, series, cssW, cssH, cands };
}

// ---- ランキングバー ----
// probe=true のときは「まだ動いているか」を返すだけで描画しない
function drawBars(probe) {
  const canvas = vels.barCanvas;
  const [t0, t1] = timeDomain();
  const t = vstate.t == null ? t1 : vstate.t;
  const series = displayedSeries();

  const rows = series
    .map((c) => ({ c, v: valueAt(c, t) }))
    .filter((r) => r.v != null)
    .sort((a, b) => b.v - a.v);

  const rowH = 40;
  const cssW = canvas.parentElement.clientWidth - 32;
  const cssH = Math.max(1, rows.length) * rowH + 16;

  // 目標位置とのズレを確認
  let moving = false;
  rows.forEach((r, i) => {
    const target = i * rowH;
    const cur = barPositions[r.c.id];
    if (cur == null) { barPositions[r.c.id] = target; }
    else if (Math.abs(cur - target) > 0.5) moving = true;
  });
  if (probe) return moving;

  rows.forEach((r, i) => {
    const target = i * rowH;
    const cur = barPositions[r.c.id];
    barPositions[r.c.id] = reducedMotion ? target : cur + (target - cur) * 0.2;
  });

  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const styles = getComputedStyle(document.documentElement);
  const cText = styles.getPropertyValue("--text").trim() || "#12263f";
  const cMuted = styles.getPropertyValue("--muted").trim() || "#5b6472";

  ctx.clearRect(0, 0, cssW, cssH);
  const maxV = rows.length ? toU(rows[0].v) : 1;
  const labelW = 150;
  const valueW = vstate.unit === "jpy" ? 90 : 80;
  const barMax = cssW - labelW - valueW - 24;
  const fontBase = '13px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif';

  rows.forEach((r, i) => {
    const y = 8 + barPositions[r.c.id];
    const barLen = Math.max(3, (toU(r.v) / maxV) * barMax);

    ctx.fillStyle = cMuted;
    ctx.font = `bold ${fontBase}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), 20, y + rowH / 2 - 4);

    ctx.fillStyle = cText;
    ctx.font = fontBase;
    ctx.textAlign = "left";
    ctx.fillText(r.c.name, 30, y + rowH / 2 - 4, labelW - 34);

    // バー本体（先端のみ4px丸め）
    const bx = labelW, by = y + rowH / 2 - 11, bh = 15;
    ctx.fillStyle = r.c.color;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + barLen - 4, by);
    ctx.arcTo(bx + barLen, by, bx + barLen, by + 4, 4);
    ctx.lineTo(bx + barLen, by + bh - 4);
    ctx.arcTo(bx + barLen, by + bh, bx + barLen - 4, by + bh, 4);
    ctx.lineTo(bx, by + bh);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = cText;
    ctx.font = fontBase;
    ctx.textAlign = "left";
    ctx.fillText(fmtU(r.v), bx + barLen + 8, y + rowH / 2 - 4);
  });

  return moving;
}

// ---- ホバー（折れ線チャートのツールチップ）----
function onHover(e) {
  if (!lineLayout) return;
  const rect = vels.lineCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const { plot, t0, t1, xOf, yOf, series, cands } = lineLayout;
  if (mx < plot.left - 10 || mx > plot.right + 10 || my < plot.top - 10 || my > plot.bottom + 10) {
    vels.tooltip.hidden = true;
    return;
  }
  // 実データの点（日次/月次/年次いずれか）のうち最も近いものを選ぶ
  let best = null;
  for (const cand of cands) {
    const d = Math.abs(xOf(cand.x) - mx);
    if (best == null || d < best.d) best = { ...cand, d };
  }
  if (!best || best.d > 40) { vels.tooltip.hidden = true; return; }

  const items = series
    .map((c) => ({ c, v: valueAt(c, best.x) }))
    .filter((r) => r.v != null)
    .sort((a, b) => b.v - a.v);
  if (!items.length) { vels.tooltip.hidden = true; return; }

  const head = best.label || `${Math.round(best.x)}年`;
  vels.tooltip.innerHTML =
    `<div class="tt-head">${head}</div>` +
    items.map((r) =>
      `<div class="tt-row"><span class="color-dot" style="background:${r.c.color}"></span>` +
      `<span class="tt-name">${r.c.name}</span><span class="tt-val">${fmtBoth(r.v)}</span></div>`
    ).join("");
  vels.tooltip.hidden = false;
  const wrapRect = vels.lineCanvas.parentElement.getBoundingClientRect();
  let tx = e.clientX - wrapRect.left + 14;
  const ttW = vels.tooltip.offsetWidth;
  if (tx + ttW > wrapRect.width - 8) tx = e.clientX - wrapRect.left - ttW - 14;
  vels.tooltip.style.left = tx + "px";
  vels.tooltip.style.top = (e.clientY - wrapRect.top + 10) + "px";
}
