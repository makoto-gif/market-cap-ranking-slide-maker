// 最新の時価総額を Yahoo Finance から取得して data/*.json を更新する。
// GitHub Actions（.github/workflows/update-data.yml）が毎日実行する。
//
// 仕組み:
//   検証済みの時価総額アンカー（CAL_ANCHORS: 特定月末の実際の時価総額、10億USD）と
//   その月の終値から「株数相当のスケール」を求め、アンカー間は線形補間する。
//     scale(アンカー月) = アンカー時価総額(現地通貨) ÷ その月の終値
//     capUSD(t) = 終値(t) × scale(t) ÷ 為替(t)
//   これにより、自社株買い・増資による発行株数の変化もアンカー間で近似され、
//   「基準日からの株価変動率」方式で起きていた過去値の歪み
//   （例: 2021年にソフトバンクGがトヨタを上回って見える誤り）を防ぐ。
//
//   アンカーの出典:
//     - 2026-08: サイト公開時（2026年8月6日）に確認した時価総額（js/data.js と同じ）
//     - トヨタ/ソフトバンクG 2021-03: stockanalysis.com（東証上場ベース、
//       JPX時価額順位表とも整合: 2021年3月末 トヨタ28.1兆円 > SBG 19.5兆円）
//     - トヨタ/ソフトバンクG の各年末: js/data.js の年末値
//     - 世界企業の2016年末・2021年末: companiesmarketcap 等で広く公表されている値
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// 検証済み時価総額アンカー（10億USD）。キーは "YYYY-MM"（その月末時点）。
const CAL_ANCHORS = {
  japan: {
    toyota: { "2016-12": 197, "2020-12": 215, "2021-03": 218, "2021-12": 253, "2026-08": 292 },
    softbankg: { "2016-12": 73, "2020-12": 142, "2021-03": 148, "2021-12": 80, "2026-08": 216 },
    mufg: { "2026-08": 266 },
    kioxia: { "2026-08": 181 },
    tokyoelectron: { "2026-08": 120 },
    sony: { "2026-08": 133 },
    ntt: { "2026-08": 82 },
    keyence: { "2026-08": 89 },
    fastretailing: { "2026-08": 89 },
    nintendo: { "2026-08": 82 },
    hitachi: { "2026-08": 127 },
    recruit: { "2026-08": 82 },
    smfg: { "2026-08": 108 },
    shinetsu: { "2026-08": 60 },
    mitsubishicorp: { "2026-08": 76 }
  },
  world: {
    nvidia: { "2016-12": 58, "2021-12": 735, "2026-08": 5050 },
    apple: { "2016-12": 617, "2021-12": 2913, "2026-08": 4470 },
    microsoft: { "2016-12": 483, "2021-12": 2525, "2026-08": 3690 },
    alphabet: { "2016-12": 539, "2021-12": 1917, "2026-08": 4530 },
    amazon: { "2016-12": 356, "2021-12": 1691, "2026-08": 3060 },
    meta: { "2016-12": 332, "2021-12": 935, "2026-08": 1500 },
    aramco: { "2019-12": 1879, "2021-12": 1979, "2026-08": 1550 },
    broadcom: { "2016-12": 70, "2021-12": 274, "2026-08": 1870 },
    tsmc: { "2016-12": 170, "2021-12": 623, "2026-08": 2110 },
    tesla: { "2016-12": 35, "2021-12": 1061, "2026-08": 1270 },
    berkshire: { "2016-12": 401, "2021-12": 669, "2026-08": 1110 },
    elililly: { "2016-12": 81, "2021-12": 263, "2026-08": 900 }
  }
};

// Yahoo Finance のティッカー
const TICKERS = {
  japan: {
    toyota: "7203.T", mufg: "8306.T", softbankg: "9984.T", kioxia: "285A.T",
    tokyoelectron: "8035.T", sony: "6758.T", ntt: "9432.T", keyence: "6861.T",
    fastretailing: "9983.T", nintendo: "7974.T", hitachi: "6501.T",
    recruit: "6098.T", smfg: "8316.T", shinetsu: "4063.T", mitsubishicorp: "8058.T"
  },
  world: {
    nvidia: "NVDA", apple: "AAPL", microsoft: "MSFT", alphabet: "GOOGL",
    amazon: "AMZN", meta: "META", aramco: "2222.SR", broadcom: "AVGO",
    tsmc: "TSM", tesla: "TSLA", berkshire: "BRK-B", elililly: "LLY"
  }
};

// 銘柄の取引通貨（為替換算に使う）
function currencyOf(symbol) {
  if (symbol.endsWith(".T")) return "JPY";
  if (symbol.endsWith(".SR")) return "SAR";
  return "USD";
}

const UA = "Mozilla/5.0 (compatible; market-cap-ranking-bot/1.0)";
const HISTORY_START_YEAR = 2016;

async function fetchChart(symbol, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${symbol}: HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`${symbol}: 応答が不正`);
  return result;
}

// 月足の終値を { "YYYY-MM": close } の形で返す（現在価格も返す）
// 注意: Yahoo のタイムスタンプは取引所のローカル時刻基準。UTC のままだと
// 東証銘柄の月初バーが前月末扱いになり、全履歴が1か月ずれるため、
// meta.gmtoffset で取引所ローカル時刻に直してから年月を求める。
async function fetchMonthly(symbol) {
  const result = await fetchChart(symbol, "11y", "1mo");
  const ts = result.timestamp || [];
  const off = result.meta?.gmtoffset ?? 0;
  const closes = result.indicators?.quote?.[0]?.close || [];
  const months = {};
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || !isFinite(c)) continue;
    const d = new Date((ts[i] + off) * 1000);
    const y = d.getUTCFullYear();
    if (y < HISTORY_START_YEAR) continue;
    const ym = `${y}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    months[ym] = c; // 同月が複数来た場合は後勝ち（＝より新しい終値）
  }
  const now = result.meta?.regularMarketPrice;
  if (now == null || !isFinite(now)) throw new Error(`${symbol}: 株価が取得できない`);
  return { months, now };
}

// 日足の終値を { "YYYY-MM-DD": close } の形で返す（直近約2年分）
async function fetchDaily(symbol) {
  const result = await fetchChart(symbol, "2y", "1d");
  const ts = result.timestamp || [];
  const off = result.meta?.gmtoffset ?? 0;
  const closes = result.indicators?.quote?.[0]?.close || [];
  const days = {};
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || !isFinite(c)) continue;
    const d = new Date((ts[i] + off) * 1000);
    const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    days[ymd] = c;
  }
  return days;
}

function loadJson(path, fallback) {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  } catch {}
  return fallback;
}

const LATEST_PATH = "data/latest.json";
const HISTORY_PATH = "data/history.json";
const HISTORY_DAILY_PATH = "data/history-daily.json";

const prevLatest = loadJson(LATEST_PATH, { values: {} });
const prevHistory = loadJson(HISTORY_PATH, { series: {} });
const prevHistoryDaily = loadJson(HISTORY_DAILY_PATH, { series: {} });

// 為替（USD→JPY、USD→SAR）: 現在レートと月足・日足の履歴を取得。
// 月足の取得失敗は致命的（履歴が計算できない）なので銘柄ごとに前回値で代替する。
const fxNow = { USD: 1 };
const fxMonths = { USD: {} };
const fxDays = { USD: {} };
const fxOk = { USD: true };
for (const [key, symbol] of [["JPY", "USDJPY=X"], ["SAR", "SAR=X"]]) {
  try {
    const { months, now } = await fetchMonthly(symbol);
    fxNow[key] = now;
    fxMonths[key] = months;
    fxOk[key] = true;
  } catch (e) {
    console.warn(`為替 ${key}（月足）の取得に失敗:`, e.message);
    fxNow[key] = key === "JPY" ? 155 : 3.75;
    fxMonths[key] = {};
    fxOk[key] = false;
  }
  try {
    fxDays[key] = await fetchDaily(symbol);
  } catch (e) {
    console.warn(`為替 ${key}（日足）の取得に失敗:`, e.message);
    fxDays[key] = {};
  }
}

// 指定キー（"YYYY-MM" または "YYYY-MM-DD"）の為替。
// なければ直近の過去、それもなければ現在値を使う
function fxLookup(map, k, fallback) {
  if (map[k] != null) return map[k];
  const keys = Object.keys(map).filter((x) => x <= k).sort();
  if (keys.length) return map[keys[keys.length - 1]];
  return fallback;
}
function fxAt(cur, ym) {
  if (cur === "USD") return 1;
  return fxLookup(fxMonths[cur] || {}, ym, fxNow[cur]);
}
function fxAtDay(cur, ymd) {
  if (cur === "USD") return 1;
  return fxLookup(fxDays[cur] || {}, ymd, fxNow[cur]);
}

// "YYYY-MM" → 連続時間（月インデックス）。月末時点なので +1 とみなす
function tOfYm(ym) {
  const [y, m] = ym.split("-").map(Number);
  return y * 12 + m;
}
// "YYYY-MM-DD" → 連続時間（月インデックスに日割りを加算）
function tOfYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return y * 12 + (m - 1) + d / 31;
}

// アンカーから「株数相当スケール」の折れ線を作る。
// scale = アンカー時価総額(現地通貨, 10億) ÷ アンカー月の終値
// アンカー月の終値がない場合は前後3か月以内で代替する。
function buildScaleline(anchors, months, cur) {
  const pts = [];
  for (const [ym, capUsdB] of Object.entries(anchors)) {
    let close = months[ym];
    if (close == null) {
      const [y, m] = ym.split("-").map(Number);
      for (let off = 1; off <= 3 && close == null; off++) {
        for (const sign of [-1, 1]) {
          const mm = m - 1 + sign * off;
          const d = new Date(Date.UTC(y, mm, 1));
          const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
          if (months[k] != null) { close = months[k]; break; }
        }
      }
    }
    if (close == null || !(close > 0)) continue;
    const capLocal = capUsdB * fxAt(cur, ym);
    pts.push({ t: tOfYm(ym), scale: capLocal / close });
  }
  pts.sort((a, b) => a.t - b.t);
  return pts;
}

// 折れ線 scaleline を時刻 t で評価（範囲外は端の値で一定）
function scaleAt(pts, t) {
  if (!pts.length) return null;
  if (t <= pts[0].t) return pts[0].scale;
  if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].scale;
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i].t) {
      const a = pts[i - 1], b = pts[i];
      const w = (t - a.t) / (b.t - a.t);
      return a.scale + (b.scale - a.scale) * w;
    }
  }
  return pts[pts.length - 1].scale;
}

const values = { japan: {}, world: {} };
const history = { japan: {}, world: {} };
const historyDaily = { japan: {}, world: {} };
let okCount = 0;
let failCount = 0;
let dailyCount = 0;

const nowYm = (() => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
})();

for (const market of ["japan", "world"]) {
  for (const [id, symbol] of Object.entries(TICKERS[market])) {
    const anchors = CAL_ANCHORS[market][id] || {};
    const cur = currencyOf(symbol);
    try {
      const { months, now } = await fetchMonthly(symbol);
      const scaleline = buildScaleline(anchors, months, cur);
      if (!scaleline.length) throw new Error("アンカーを株価に対応付けできない");

      // 月次履歴: 終値 × scale ÷ 為替
      const hist = {};
      for (const [ym, close] of Object.entries(months)) {
        const s = scaleAt(scaleline, tOfYm(ym));
        const capM = (close * s) / fxAt(cur, ym);
        hist[ym] = Math.round(capM * 10) / 10;
      }
      history[market][id] = hist;

      // 最新値: 現在株価 × 現時点の scale ÷ 現在為替
      const sNow = scaleAt(scaleline, tOfYm(nowYm));
      const cap = (now * sNow) / (fxNow[cur] ?? 1);
      values[market][id] = Math.round(cap * 10) / 10;

      // 日次履歴（直近約2年）: 乱高下の確認用
      try {
        const days = await fetchDaily(symbol);
        const histD = {};
        for (const [ymd, close] of Object.entries(days)) {
          const s = scaleAt(scaleline, tOfYmd(ymd));
          const capD = (close * s) / fxAtDay(cur, ymd);
          histD[ymd] = Math.round(capD * 10) / 10;
        }
        historyDaily[market][id] = histD;
        dailyCount++;
      } catch (e) {
        console.warn(`${market}/${id} (${symbol}) 日足の取得に失敗:`, e.message);
        const prevD = prevHistoryDaily.series?.[market]?.[id];
        if (prevD) historyDaily[market][id] = prevD;
      }

      okCount++;
      await new Promise((r) => setTimeout(r, 300)); // レート制限対策
    } catch (e) {
      console.warn(`${market}/${id} (${symbol}) の取得に失敗:`, e.message);
      // 失敗した銘柄は前回値を維持する（最新値・履歴とも）
      const anchorVals = Object.values(anchors);
      values[market][id] = prevLatest.values?.[market]?.[id] ?? anchorVals[anchorVals.length - 1];
      const prevH = prevHistory.series?.[market]?.[id];
      if (prevH) history[market][id] = prevH;
      const prevD = prevHistoryDaily.series?.[market]?.[id];
      if (prevD) historyDaily[market][id] = prevD;
      failCount++;
    }
  }
}

const updatedAt = new Date().toISOString();
const latest = {
  updatedAt,
  usdJpy: Math.round(fxNow.JPY * 10) / 10,
  values
};

writeFileSync(LATEST_PATH, JSON.stringify(latest, null, 2) + "\n");
if (okCount > 0) {
  writeFileSync(HISTORY_PATH, JSON.stringify({ updatedAt, series: history }) + "\n");
  if (dailyCount > 0 || Object.keys(prevHistoryDaily.series?.japan || {}).length) {
    writeFileSync(HISTORY_DAILY_PATH, JSON.stringify({ updatedAt, series: historyDaily }) + "\n");
  }
}
console.log(`更新完了: 成功 ${okCount} 件 / 失敗 ${failCount} 件, USDJPY=${latest.usdJpy}`);

// 全銘柄失敗した場合はワークフローを失敗させて気付けるようにする
if (okCount === 0) {
  console.error("全銘柄の取得に失敗しました");
  process.exit(1);
}
