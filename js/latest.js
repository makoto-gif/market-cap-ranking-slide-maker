// data/latest.json（最新値）、data/history.json(月次履歴)、data/history-daily.json（日次履歴）を
// 読み込む。いずれも GitHub Actions が毎日更新する。読めない場合（file://直開き・初回など）は
// 同梱の年次データのまま動く。
let HAS_MONTHLY = false;
let HAS_DAILY = false;

function loadLatest() {
  return fetch("data/latest.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((j) => {
      if (!j) return;
      for (const mkt of ["japan", "world"]) {
        const vals = (j.values && j.values[mkt]) || {};
        for (const c of MARKET_DATA[mkt].companies) {
          if (vals[c.id] != null && isFinite(vals[c.id])) {
            c.values[LATEST_YEAR] = vals[c.id];
          }
        }
      }
      if (j.usdJpy && isFinite(j.usdJpy)) LATEST_META.usdJpy = j.usdJpy;
      if (j.updatedAt) {
        const d = new Date(j.updatedAt);
        if (!isNaN(d)) {
          // 閲覧環境のタイムゾーンに関わらず日本時間で年月日を出す
          const jst = new Date(d.getTime() + 9 * 3600 * 1000);
          LATEST_META.year = jst.getUTCFullYear();
          LATEST_META.month = jst.getUTCMonth() + 1;
          LATEST_META.day = jst.getUTCDate();
          LATEST_META.updatedAt = j.updatedAt;
          LATEST_META.live = true;
        }
      }
    });
}

function daysInYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
}

// "YYYY-MM" → x（年の小数）とラベル
function monthKeyToPoint(ym, v) {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m || !isFinite(v)) return null;
  return { x: y + (m - 1) / 12, v, src: "m", label: `${y}年${m}月` };
}

// "YYYY-MM-DD" → x（年の小数）とラベル
function dayKeyToPoint(ymd, v) {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d || !isFinite(v)) return null;
  const dayOfYear = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000);
  return { x: y + dayOfYear / daysInYear(y), v, src: "d", label: `${y}年${m}月${d}日` };
}

// 履歴JSONを読み込んで各社にポイント列を付与する共通処理
function loadSeriesFile(path, toPoint, attach) {
  return fetch(path, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((j) => {
      if (!j || !j.series) return false;
      let any = false;
      for (const mkt of ["japan", "world"]) {
        const seriesMap = j.series[mkt] || {};
        for (const c of MARKET_DATA[mkt].companies) {
          const entries = seriesMap[c.id];
          if (!entries) continue;
          const pts = Object.entries(entries)
            .map(([k, v]) => toPoint(k, v))
            .filter(Boolean)
            .sort((a, b) => a.x - b.x);
          if (pts.length >= 2) {
            attach(c, pts);
            any = true;
          }
        }
      }
      return any;
    });
}

// 同梱の月次データ（BUNDLED_MONTHLY）を適用する。
// data/history.json（実データ）が読めなかったときのフォールバック。
function applyBundledMonthly() {
  if (typeof BUNDLED_MONTHLY === "undefined") return;
  let any = false;
  for (const mkt of ["japan", "world"]) {
    const seriesMap = BUNDLED_MONTHLY[mkt] || {};
    for (const c of MARKET_DATA[mkt].companies) {
      const entries = seriesMap[c.id];
      if (!entries) continue;
      const pts = Object.entries(entries)
        .map(([k, v]) => monthKeyToPoint(k, v))
        .filter(Boolean)
        .sort((a, b) => a.x - b.x);
      if (pts.length >= 2) {
        c._monthly = pts;
        any = true;
      }
    }
  }
  if (any) HAS_MONTHLY = true;
}

const latestReady = Promise.all([
  loadLatest(),
  loadSeriesFile("data/history.json", monthKeyToPoint, (c, pts) => { c._monthly = pts; }).then((ok) => {
    HAS_MONTHLY = ok;
    if (!ok) applyBundledMonthly();
  }),
  loadSeriesFile("data/history-daily.json", dayKeyToPoint, (c, pts) => { c._daily = pts; }).then((ok) => { HAS_DAILY = ok; })
]).then(() => {});

// 最新値のグラフ上のX位置（例: 2026年8月 → 2026 + 7/12）。
// 年をまたいでデータ年が追い付いていない場合は年内に収める。
function currentFractionalYear() {
  if (LATEST_META.year > LATEST_YEAR) return LATEST_YEAR + 0.95;
  const { year, month, day } = LATEST_META;
  if (day) {
    const dayOfYear = Math.floor((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86400000);
    return year + dayOfYear / daysInYear(year);
  }
  return year + (month - 1) / 12;
}

// 「2026年8月6日」または日が不明なら「2026年8月」
function latestDateText() {
  const { year, month, day } = LATEST_META;
  return day ? `${year}年${month}月${day}日` : `${year}年${month}月`;
}

function currentPointLabel() {
  return `現在（${latestDateText()}時点）`;
}

// 2点間を線で結んで良いか（欠測区間の判定）。
// 日次同士は約2週間、月次を含む場合は約3ヶ月、年次を含む場合は1.6年まで許容。
// 末尾の「現在」点への接続は常に許可する。
function segOk(prev, p) {
  if (p.cur) return true;
  const gap = p.x - prev.x;
  if (prev.src === "y" || p.src === "y") return gap <= 1.6;
  if (prev.src === "m" || p.src === "m") return gap <= 0.26;
  return gap <= 0.045;
}

// 描画に使う点列を返す。
//   granularity: "auto" | "daily" | "monthly" | "yearly"
//   daily   … 日次履歴（直近約2年）＋それ以前は月次で補完
//   monthly … 月次履歴
//   yearly  … 年次（同梱データ）
// 指定した粒度のデータがなければ細かい方から順にフォールバックする。
// endYear が最新年のときは最新値の点（currentT 位置）を末尾に足す。
function seriesDrawPoints(c, startYear, endYear, granularity = "auto") {
  const isLatestEnd = endYear === LATEST_YEAR;
  const curT = isLatestEnd ? currentFractionalYear() : null;

  const wantDaily = (granularity === "auto" || granularity === "daily") && c._daily;
  const wantMonthly = granularity !== "yearly" && c._monthly;

  // 細かいデータで覆えない古い期間は年次の値で補完する
  const yearlyBefore = (beforeX) => {
    const pre = [];
    for (let y = startYear; y <= endYear; y++) {
      if (y >= beforeX - 1e-6) break;
      const v = c.values[y];
      if (v == null) continue;
      pre.push({ x: y, v, src: "y", mark: true, label: `${y}年末` });
    }
    return pre;
  };

  let pts = [];
  let mode = "y";
  if (wantDaily) {
    mode = "d";
    const dailyStart = c._daily[0].x;
    if (c._monthly) {
      pts = c._monthly.filter((p) => p.x < dailyStart - 1e-6);
    }
    pts = pts.concat(c._daily);
    if (pts.length) pts = yearlyBefore(pts[0].x).concat(pts);
  } else if (wantMonthly) {
    mode = "m";
    pts = c._monthly.slice();
    if (pts.length) pts = yearlyBefore(pts[0].x).concat(pts);
  }

  if (pts.length >= 2) {
    const endX = curT != null ? curT : endYear + 11 / 12;
    pts = pts.filter((p) => p.x >= startYear - 1e-6 && p.x <= endX + 1e-6);
    // マーカーは各年12月（月次）／12月末（日次は年末最終営業日）に付ける
    let lastYearMark = null;
    for (const p of pts) {
      if (p.src === "m" && Math.abs((p.x % 1) - 11 / 12) < 1e-3) p.mark = true;
    }
    if (isLatestEnd && c.values[LATEST_YEAR] != null) {
      if (pts.length && curT - pts[pts.length - 1].x < 1 / 200) pts.pop();
      pts.push({ x: curT, v: c.values[LATEST_YEAR], cur: true, mark: true, src: mode, label: latestDateText() });
    }
    if (pts.length >= 2) return { pts, mode, endX };
  }

  // 年次フォールバック
  const ypts = [];
  for (let y = startYear; y <= endYear; y++) {
    const v = c.values[y];
    if (v == null) continue;
    const isCur = y === endYear && curT != null;
    ypts.push({
      x: isCur ? curT : y,
      v,
      src: "y",
      mark: true,
      cur: isCur || undefined,
      label: isCur ? latestDateText() : `${y}年末`
    });
  }
  return { pts: ypts, mode: "y", endX: curT != null ? curT : endYear };
}

// 数値の表示用フォーマット（1000以上はカンマ区切り、それ未満は小数1桁まで）
function formatValue(v) {
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// 10億USD → 兆円
function usdBToJpyT(v) {
  return (v * LATEST_META.usdJpy) / 1000;
}

function formatJpyT(v) {
  const t = usdBToJpyT(v);
  if (t >= 100) return t.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return t.toFixed(1);
}
