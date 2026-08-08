// 最新の時価総額を Yahoo Finance から取得して data/latest.json を更新する。
// GitHub Actions（.github/workflows/update-data.yml）が毎日実行する。
//
// 仕組み:
//   初回実行時に各銘柄の株価と為替を data/baseline.json に記録し、
//   基準時点の時価総額（BASE_CAPS_USD_B、10億USD）に株価変動率と為替変動率を
//   掛けて最新の時価総額を推計する（発行株数の増減は考慮しない概算）。
//     capUSD = baseCap × (price / basePrice) ÷ (fx / baseFx)
import { readFileSync, writeFileSync, existsSync } from "node:fs";

// 基準時点（2026年8月6日）の時価総額（10億USD）。js/data.js の最新年の値と揃える。
const BASE_CAPS_USD_B = {
  japan: {
    toyota: 292, mufg: 266, softbankg: 216, kioxia: 181, tokyoelectron: 120,
    sony: 133, ntt: 82, keyence: 89, fastretailing: 89, nintendo: 82,
    hitachi: 127, recruit: 82, smfg: 108, shinetsu: 60, mitsubishicorp: 76
  },
  world: {
    nvidia: 5050, apple: 4470, microsoft: 3690, alphabet: 4530, amazon: 3060,
    meta: 1500, aramco: 1550, broadcom: 1870, tsmc: 2110, tesla: 1270,
    berkshire: 1110, elililly: 900
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

// 銘柄の取引通貨（為替変動の補正に使う）
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

async function fetchPrice(symbol) {
  const result = await fetchChart(symbol, "5d", "1d");
  const price = result.meta?.regularMarketPrice;
  if (price == null || !isFinite(price)) throw new Error(`${symbol}: 株価が取得できない`);
  return price;
}

// 月足の終値を { "YYYY-MM": close } の形で返す（現在価格も返す）
async function fetchMonthly(symbol) {
  const result = await fetchChart(symbol, "11y", "1mo");
  const ts = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const months = {};
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || !isFinite(c)) continue;
    const d = new Date(ts[i] * 1000);
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
  const closes = result.indicators?.quote?.[0]?.close || [];
  const days = {};
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || !isFinite(c)) continue;
    const d = new Date(ts[i] * 1000);
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

const BASELINE_PATH = "data/baseline.json";
const LATEST_PATH = "data/latest.json";
const HISTORY_PATH = "data/history.json";
const HISTORY_DAILY_PATH = "data/history-daily.json";

const baseline = loadJson(BASELINE_PATH, { prices: {}, fx: {} });
const prevLatest = loadJson(LATEST_PATH, { values: {} });

// 為替（USD→JPY、USD→SAR）: 現在レートと月足の履歴を取得
const fxNow = { USD: 1 };
const fxMonths = { USD: {} };
const fxDays = { USD: {} };
for (const [key, symbol] of [["JPY", "USDJPY=X"], ["SAR", "SAR=X"]]) {
  try {
    const { months, now } = await fetchMonthly(symbol);
    fxNow[key] = now;
    fxMonths[key] = months;
    fxDays[key] = await fetchDaily(symbol);
    if (baseline.fx[key] == null) baseline.fx[key] = now;
  } catch (e) {
    console.warn(`為替 ${key} の取得に失敗:`, e.message);
    fxNow[key] = baseline.fx[key] ?? (key === "JPY" ? 155 : 3.75);
    fxMonths[key] = {};
    fxDays[key] = {};
  }
}
baseline.fx.USD = 1;

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

const values = { japan: {}, world: {} };
const history = { japan: {}, world: {} };
const historyDaily = { japan: {}, world: {} };
let okCount = 0;
let failCount = 0;

for (const market of ["japan", "world"]) {
  for (const [id, symbol] of Object.entries(TICKERS[market])) {
    const baseCap = BASE_CAPS_USD_B[market][id];
    const cur = currencyOf(symbol);
    try {
      const { months, now } = await fetchMonthly(symbol);
      if (baseline.prices[symbol] == null) baseline.prices[symbol] = now;

      // 最新値: 基準時点からの株価変動率と為替変動率で推計
      const fxRatio = (fxNow[cur] ?? 1) / (baseline.fx[cur] ?? 1);
      const cap = baseCap * (now / baseline.prices[symbol]) / fxRatio;
      values[market][id] = Math.round(cap * 10) / 10;

      // 月次履歴: 各月の終値と為替から同じ方法で推計
      const hist = {};
      for (const [ym, close] of Object.entries(months)) {
        const fxR = (fxAt(cur, ym) ?? 1) / (fxNow[cur] ?? 1);
        const capM = baseCap * (close / now) / fxR;
        hist[ym] = Math.round(capM * 10) / 10;
      }
      history[market][id] = hist;

      // 日次履歴（直近約2年）: 乱高下の確認用
      const days = await fetchDaily(symbol);
      const histD = {};
      for (const [ymd, close] of Object.entries(days)) {
        const fxR = (fxAtDay(cur, ymd) ?? 1) / (fxNow[cur] ?? 1);
        const capD = baseCap * (close / now) / fxR;
        histD[ymd] = Math.round(capD * 10) / 10;
      }
      historyDaily[market][id] = histD;

      okCount++;
      await new Promise((r) => setTimeout(r, 300)); // レート制限対策
    } catch (e) {
      console.warn(`${market}/${id} (${symbol}) の取得に失敗:`, e.message);
      // 失敗した銘柄は前回値（なければ基準値）を維持する
      values[market][id] = prevLatest.values?.[market]?.[id] ?? baseCap;
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
writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
if (okCount > 0) {
  writeFileSync(HISTORY_PATH, JSON.stringify({ updatedAt, series: history }) + "\n");
  writeFileSync(HISTORY_DAILY_PATH, JSON.stringify({ updatedAt, series: historyDaily }) + "\n");
}
console.log(`更新完了: 成功 ${okCount} 件 / 失敗 ${failCount} 件, USDJPY=${latest.usdJpy}`);

// 全銘柄失敗した場合はワークフローを失敗させて気付けるようにする
if (okCount === 0) {
  console.error("全銘柄の取得に失敗しました");
  process.exit(1);
}
