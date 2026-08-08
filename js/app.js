// スライド作成ページ: UI 状態と描画・ダウンロードの制御
const state = {
  market: "japan",       // "japan" | "world"
  mode: "top",           // "top"（上位N社） | "custom"（企業を選ぶ）
  topN: 5,
  selectedIds: { japan: [], world: [] },
  startYear: YEARS[0],
  endYear: LATEST_YEAR,
  showFuture: true,
  showFutureCopy: true,  // 「次の覇者は？」の文言を入れるか
  unit: "usd",           // "usd" | "jpy" | "both"
  granularity: "auto",   // "auto" | "daily" | "monthly" | "yearly"
  customTitle: ""        // 空なら自動タイトル
};

const els = {};
document.addEventListener("DOMContentLoaded", () => {
  ["marketToggle", "modeToggle", "topNRow", "topN", "companyListRow", "companyList",
   "startYear", "endYear", "showFuture", "showFutureCopy", "unitToggle", "granToggle",
   "titleInput", "canvas", "downloadPng", "downloadPptx",
   "rankingList", "rankingHeading", "resetCompanies", "dataBadge"
  ].forEach((id) => { els[id] = document.getElementById(id); });

  // 年セレクトを生成
  for (const y of YEARS) {
    els.startYear.add(new Option(`${y}年`, y));
    els.endYear.add(new Option(`${y}年`, y));
  }
  els.startYear.value = state.startYear;
  els.endYear.value = state.endYear;

  els.marketToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-market]");
    if (!btn) return;
    state.market = btn.dataset.market;
    buildCompanyList();
    render();
  });
  els.modeToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mode]");
    if (!btn) return;
    state.mode = btn.dataset.mode;
    render();
  });
  els.unitToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-unit]");
    if (!btn) return;
    state.unit = btn.dataset.unit;
    render();
  });
  els.granToggle.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-gran]");
    if (!btn) return;
    state.granularity = btn.dataset.gran;
    render();
  });
  els.topN.addEventListener("change", () => { state.topN = Number(els.topN.value); render(); });
  els.startYear.addEventListener("change", onYearChange);
  els.endYear.addEventListener("change", onYearChange);
  els.showFuture.addEventListener("change", () => { state.showFuture = els.showFuture.checked; render(); });
  els.showFutureCopy.addEventListener("change", () => { state.showFutureCopy = els.showFutureCopy.checked; render(); });
  els.titleInput.addEventListener("input", () => { state.customTitle = els.titleInput.value; render(); });
  els.resetCompanies.addEventListener("click", () => {
    state.selectedIds[state.market] = [];
    buildCompanyList();
    render();
  });

  els.downloadPng.addEventListener("click", downloadPng);
  els.downloadPptx.addEventListener("click", downloadPptx);

  window.addEventListener("resize", () => render());

  buildCompanyList();
  render();
  // 最新データ読み込み後に再描画
  latestReady.then(() => { buildCompanyList(); render(); });
});

function onYearChange() {
  let s = Number(els.startYear.value);
  let e = Number(els.endYear.value);
  if (s >= e) {
    // 開始年 >= 終了年 にならないように補正
    if (document.activeElement === els.startYear) e = Math.min(YEARS[YEARS.length - 1], s + 1);
    else s = Math.max(YEARS[0], e - 1);
    els.startYear.value = s;
    els.endYear.value = e;
  }
  state.startYear = s;
  state.endYear = e;
  render();
}

function buildCompanyList() {
  const { companies } = MARKET_DATA[state.market];
  els.companyList.innerHTML = "";
  const selected = state.selectedIds[state.market];
  for (const c of companies) {
    const label = document.createElement("label");
    label.className = "company-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = c.id;
    cb.checked = selected.includes(c.id);
    cb.addEventListener("change", () => {
      const arr = state.selectedIds[state.market];
      if (cb.checked) { if (!arr.includes(c.id)) arr.push(c.id); }
      else { state.selectedIds[state.market] = arr.filter((id) => id !== c.id); }
      render();
    });
    const dot = document.createElement("span");
    dot.className = "color-dot";
    dot.style.background = c.color;
    label.append(cb, dot, document.createTextNode(c.name));
    els.companyList.appendChild(label);
  }
}

function getDisplayedSeries() {
  const { companies } = MARKET_DATA[state.market];
  if (state.mode === "custom") {
    const selected = state.selectedIds[state.market];
    if (selected.length > 0) return companies.filter((c) => selected.includes(c.id));
    // 未選択なら上位N社にフォールバック
  }
  return [...companies]
    .filter((c) => c.values[state.endYear] != null)
    .sort((a, b) => b.values[state.endYear] - a.values[state.endYear])
    .slice(0, state.topN);
}

function buildConfig() {
  const market = MARKET_DATA[state.market];
  const series = getDisplayedSeries();
  const isTop = state.mode === "top" || state.selectedIds[state.market].length === 0;
  const autoTitle = isTop
    ? `${market.label} 時価総額トップ${series.length}の推移と、これから`
    : `${market.label} 時価総額 主要${series.length}社の推移と、これから`;

  const isLatestEnd = state.endYear === LATEST_YEAR;
  const jpyInvolved = state.unit !== "usd";
  const footnoteParts = [];
  if (isLatestEnd) {
    footnoteParts.push(`注: ${state.startYear}〜${state.endYear - 1}は各年末、最新値は${latestDateText()}時点`);
  } else {
    footnoteParts.push("注: 各年末時点の値");
  }
  if (jpyInvolved) footnoteParts.push(`1USD=${LATEST_META.usdJpy}円で換算`);
  footnoteParts.push("出典: CompaniesMarketCap／Yahoo Finance（概算値）");

  const yAxisLabel = state.unit === "jpy" ? "時価総額（兆円）" : "時価総額（10億USD）";

  return {
    title: state.customTitle.trim() || autoTitle,
    subtitle: state.showFuture ? `${state.startYear}→${state.endYear}→未来` : `${state.startYear}→${state.endYear}`,
    footnote: footnoteParts.join("。") + "。",
    startYear: state.startYear,
    endYear: state.endYear,
    showFuture: state.showFuture,
    showFutureCopy: state.showFutureCopy,
    futureEndYear: state.endYear + 4,
    currentT: isLatestEnd ? currentFractionalYear() : null,
    granularity: state.granularity,
    currentLabel: isLatestEnd ? currentPointLabel() : `${state.endYear}年末`,
    unit: state.unit,
    yAxisLabel,
    series
  };
}

function render() {
  // トグルの活性状態
  for (const btn of els.marketToggle.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.market === state.market);
  }
  for (const btn of els.modeToggle.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.mode === state.mode);
  }
  for (const btn of els.unitToggle.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.unit === state.unit);
  }
  for (const btn of els.granToggle.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.gran === state.granularity);
  }
  els.topNRow.hidden = state.mode !== "top";
  els.companyListRow.hidden = state.mode !== "custom";
  els.showFutureCopy.disabled = !state.showFuture;

  const cfg = buildConfig();
  els.titleInput.placeholder = cfg.title;
  els.dataBadge.textContent = LATEST_META.live
    ? `データ更新: ${latestDateText()}`
    : `同梱データ: ${latestDateText()}時点`;

  // プレビュー canvas（コンテナ幅 × devicePixelRatio で描画）
  const canvas = els.canvas;
  const cssW = canvas.parentElement.clientWidth;
  const cssH = cssW * (SLIDE_H / SLIDE_W);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  drawSlide(canvas, cfg);

  renderRanking(cfg);
}

function renderRanking(cfg) {
  const when = state.endYear === LATEST_YEAR ? latestDateText() : `${state.endYear}年末`;
  els.rankingHeading.textContent = `${MARKET_DATA[state.market].label}ランキング（${when}）`;
  els.rankingList.innerHTML = "";
  const ranked = [...cfg.series]
    .filter((c) => c.values[state.endYear] != null)
    .sort((a, b) => b.values[state.endYear] - a.values[state.endYear]);

  // 開始年時点の順位（表示対象内での比較）と変動を表示
  const startRanked = [...cfg.series]
    .filter((c) => c.values[state.startYear] != null)
    .sort((a, b) => b.values[state.startYear] - a.values[state.startYear])
    .map((c) => c.id);

  ranked.forEach((c, i) => {
    const li = document.createElement("li");
    const prev = startRanked.indexOf(c.id);
    let delta = "🆕";
    if (prev >= 0) {
      const d = prev - i;
      delta = d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : "－";
    }
    const v = c.values[state.endYear];
    li.innerHTML =
      `<span class="rank-no">${i + 1}</span>` +
      `<span class="color-dot" style="background:${c.color}"></span>` +
      `<span class="rank-name">${c.name}</span>` +
      `<span class="rank-delta">${delta}</span>` +
      `<span class="rank-value">$${formatValue(v)}B<small> / ${formatJpyT(v)}兆円</small></span>`;
    els.rankingList.appendChild(li);
  });
}

// ---- ダウンロード ----
function renderExportCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 1920 * 2;   // 高解像度（3840x2160）
  canvas.height = 1080 * 2;
  drawSlide(canvas, buildConfig());
  return canvas;
}

function exportFileBase() {
  const cfg = buildConfig();
  return cfg.title.replace(/[\\/:*?"<>|\s]+/g, "_");
}

function downloadPng() {
  const canvas = renderExportCanvas();
  canvas.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${exportFileBase()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, "image/png");
}

let pptxLoading = null;
function loadPptxgen() {
  if (window.PptxGenJS) return Promise.resolve();
  if (pptxLoading) return pptxLoading;
  pptxLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "js/vendor/pptxgen.bundle.js";
    script.onload = resolve;
    script.onerror = () => { pptxLoading = null; reject(new Error("pptxgenjs の読み込みに失敗")); };
    document.head.appendChild(script);
  });
  return pptxLoading;
}

async function downloadPptx() {
  els.downloadPptx.disabled = true;
  try {
    await loadPptxgen();
    const canvas = renderExportCanvas();
    const dataUrl = canvas.toDataURL("image/png");
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });
    pptx.layout = "WIDE";
    const slide = pptx.addSlide();
    slide.addImage({ data: dataUrl, x: 0, y: 0, w: 13.333, h: 7.5 });
    await pptx.writeFile({ fileName: `${exportFileBase()}.pptx` });
  } catch (err) {
    alert("PPTXの生成に失敗しました。代わりにPNGをダウンロードします。");
    downloadPng();
  } finally {
    els.downloadPptx.disabled = false;
  }
}
