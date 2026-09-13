// MD Shawon Traders — Worker v4.0
// Real-market analysis through Twelve Data.
// OTC remains WAIT until a verified Quotex OTC feed is connected.
// No paid AI required.

const APP = "MD Shawon Traders";
const VERSION = "4.0.0";

const INTERVALS = new Set([
  "1min",
  "5min",
  "15min",
  "30min",
  "45min",
  "1h",
  "2h",
  "4h",
  "8h",
  "1day",
  "1week",
  "1month"
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS
  });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function rnd(v, d = 6) {
  return v == null ? null : Math.round(v * 10 ** d) / 10 ** d;
}

function normalizeSymbol(symbol) {
  return String(symbol || "EUR/USD")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normalizeCandles(values) {
  if (!Array.isArray(values)) return [];

  return values
    .map(x => ({
      datetime: x.datetime,
      open: num(x.open),
      high: num(x.high),
      low: num(x.low),
      close: num(x.close),
      volume: num(x.volume) || 0
    }))
    .filter(
      x =>
        x.open !== null &&
        x.high !== null &&
        x.low !== null &&
        x.close !== null
    )
    .sort(
      (a, b) =>
        new Date(a.datetime).getTime() -
        new Date(b.datetime).getTime()
    );
}

function emaSeries(values, period) {
  if (!Array.isArray(values) || values.length < period) return [];

  const out = new Array(values.length).fill(null);

  let e = 0;

  for (let i = 0; i < period; i++) {
    e += values[i];
  }

  e /= period;
  out[period - 1] = e;

  const k = 2 / (period + 1);

  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }

  return out;
}

function ema(values, period) {
  const s = emaSeries(values, period);
  return s.length ? s.at(-1) : null;
}

function rsi(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) {
    return null;
  }

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];

    if (d > 0) gain += d;
    else loss -= d;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];

    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);

    avgGain =
      ((avgGain * (period - 1)) + g) / period;

    avgLoss =
      ((avgLoss * (period - 1)) + l) / period;
  }

  if (avgLoss === 0) return 100;

  return 100 - 100 / (1 + avgGain / avgLoss);
}

function atr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length <= period) {
    return null;
  }

  const tr = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];

    tr.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - p.close),
        Math.abs(c.low - p.close)
      )
    );
  }

  if (tr.length < period) return null;

  let a =
    tr.slice(0, period)
      .reduce((x, y) => x + y, 0) / period;

  for (let i = period; i < tr.length; i++) {
    a =
      ((a * (period - 1)) + tr[i]) / period;
  }

  return a;
}

function macd(values) {
  if (!Array.isArray(values) || values.length < 40) {
    return {
      line: null,
      signal: null,
      histogram: null
    };
  }

  const e12 = emaSeries(values, 12);
  const e26 = emaSeries(values, 26);

  const line = [];

  for (let i = 0; i < values.length; i++) {
    if (e12[i] != null && e26[i] != null) {
      line.push(e12[i] - e26[i]);
    }
  }

  if (line.length < 9) {
    return {
      line: line.at(-1) ?? null,
      signal: null,
      histogram: null
    };
  }

  const signal = ema(line, 9);
  const last = line.at(-1);

  return {
    line: last,
    signal,
    histogram:
      signal == null ? null : last - signal
  };
}

function candleInfo(c) {
  const range = Math.max(c.high - c.low, 1e-12);
  const body = Math.abs(c.close - c.open);

  const upper =
    c.high - Math.max(c.open, c.close);

  const lower =
    Math.min(c.open, c.close) - c.low;

  const bodyRatio = body / range;

  let direction =
    c.close > c.open
      ? "BUYER"
      : c.close < c.open
      ? "SELLER"
      : "NEUTRAL";

  let pattern = "NORMAL";

  if (c.close > c.open && bodyRatio >= 0.65) {
    pattern = "STRONG BULLISH";
  } else if (c.close < c.open && bodyRatio >= 0.65) {
    pattern = "STRONG BEARISH";
  } else if (
    lower >= body * 2 &&
    lower >= upper * 1.3
  ) {
    pattern = "HAMMER / BULLISH REJECTION";
  } else if (
    upper >= body * 2 &&
    upper >= lower * 1.3
  ) {
    pattern = "SHOOTING STAR / BEARISH REJECTION";
  }

  return {
    direction,
    pattern,
    range,
    body,
    upper,
    lower,
    bodyRatio
  };
}

function pressure(candles) {
  const recent = candles.slice(-6);

  if (!recent.length) {
    return {
      label: "NEUTRAL",
      score: 0
    };
  }

  let score = 0;

  for (const c of recent) {
    const info = candleInfo(c);

    const signedBody =
      (c.close - c.open) / info.range;

    score += signedBody;
  }

  score /= recent.length;

  if (score >= 0.35) {
    return {
      label: "STRONG BUYER",
      score
    };
  }

  if (score >= 0.10) {
    return {
      label: "BUYER",
      score
    };
  }

  if (score <= -0.35) {
    return {
      label: "STRONG SELLER",
      score
    };
  }

  if (score <= -0.10) {
    return {
      label: "SELLER",
      score
    };
  }

  return {
    label: "NEUTRAL",
    score
  };
}

function supportResistance(candles) {
  const r = candles.slice(-60);

  if (!r.length) {
    return {
      support: null,
      resistance: null
    };
  }

  const lows = r.map(x => x.low);
  const highs = r.map(x => x.high);

  return {
    support: Math.min(...lows),
    resistance: Math.max(...highs)
  };
}

function trend(closes) {
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);

  if (
    e9 == null ||
    e21 == null ||
    e50 == null
  ) {
    return "UNKNOWN";
  }

  if (e9 > e21 && e21 > e50) {
    return "UPTREND";
  }

  if (e9 < e21 && e21 < e50) {
    return "DOWNTREND";
  }

  return "SIDEWAYS";
}

function analyze(rawCandles) {
  if (
    !Array.isArray(rawCandles) ||
    rawCandles.length < 60
  ) {
    return {
      ok: false,
      error:
        `Not enough candle data (${rawCandles?.length || 0}); ` +
        `need at least 60 candles.`
    };
  }

  const candles = rawCandles
    .slice()
    .sort(
      (a, b) =>
        new Date(a.datetime).getTime() -
        new Date(b.datetime).getTime()
    );

  const live = candles.at(-1);
  const closed = candles.slice(0, -1);

  if (closed.length < 60) {
    return {
      ok: false,
      error:
        "Not enough closed candles after excluding newest candle."
    };
  }

  const closes = closed.map(x => x.close);

  const previous = closed.at(-1);
  const previous2 = closed.at(-2);

  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);

  const R = rsi(closes, 14);
  const A = atr(closed, 14);
  const M = macd(closes);
  const T = trend(closes);
  const P = pressure(closed);
  const sr = supportResistance(closed);

  const info = candleInfo(previous);
  const prev2Info = candleInfo(previous2);

  let buy = 0;
  let sell = 0;

  const buyReasons = [];
  const sellReasons = [];

  if (T === "UPTREND") {
    buy += 18;
    buyReasons.push("EMA 9 > EMA 21 > EMA 50");
  }

  if (T === "DOWNTREND") {
    sell += 18;
    sellReasons.push("EMA 9 < EMA 21 < EMA 50");
  }

  if (previous.close > e21) {
    buy += 8;
    buyReasons.push("Closed price above EMA21");
  }

  if (previous.close < e21) {
    sell += 8;
    sellReasons.push("Closed price below EMA21");
  }

  if (R != null) {
    if (R >= 52 && R < 70) {
      buy += 8;
      buyReasons.push("RSI supports bullish momentum");
    } else if (R > 30 && R <= 48) {
      sell += 8;
      sellReasons.push("RSI supports bearish momentum");
    } else if (R >= 70) {
      sell += 3;
      sellReasons.push("RSI overbought caution");
    } else if (R <= 30) {
      buy += 3;
      buyReasons.push("RSI oversold rebound caution");
    }
  }

  if (
    M.histogram != null &&
    M.histogram > 0
  ) {
    buy += 12;
    buyReasons.push("MACD histogram bullish");
  }

  if (
    M.histogram != null &&
    M.histogram < 0
  ) {
    sell += 12;
    sellReasons.push("MACD histogram bearish");
  }

  if (P.label === "STRONG BUYER") {
    buy += 12;
    buyReasons.push("Strong buyer pressure");
  } else if (P.label === "BUYER") {
    buy += 6;
    buyReasons.push("Buyer pressure");
  }

  if (P.label === "STRONG SELLER") {
    sell += 12;
    sellReasons.push("Strong seller pressure");
  } else if (P.label === "SELLER") {
    sell += 6;
    sellReasons.push("Seller pressure");
  }

  if (info.direction === "BUYER") {
    buy += 7;
    buyReasons.push("Previous closed candle was buyer");
  }

  if (info.direction === "SELLER") {
    sell += 7;
    sellReasons.push("Previous closed candle was seller");
  }

  if (info.pattern.includes("BULLISH")) {
    buy += 5;
    buyReasons.push(info.pattern);
  }

  if (info.pattern.includes("BEARISH")) {
    sell += 5;
    sellReasons.push(info.pattern);
  }

  if (
    info.direction === "BUYER" &&
    prev2Info.direction === "BUYER"
  ) {
    buy += 5;
    buyReasons.push("Two consecutive buyer candles");
  }

  if (
    info.direction === "SELLER" &&
    prev2Info.direction === "SELLER"
  ) {
    sell += 5;
    sellReasons.push("Two consecutive seller candles");
  }

  const momentum =
    A
      ? (previous.close - closed.at(-6).close) / A
      : 0;

  if (momentum > 0.5) {
    buy += 8;
    buyReasons.push("Positive momentum");
  }

  if (momentum < -0.5) {
    sell += 8;
    sellReasons.push("Negative momentum");
  }

  const range =
    sr.resistance - sr.support;

  if (range > 0) {
    const nearSupport =
      (previous.close - sr.support) / range < 0.12;

    const nearResistance =
      (sr.resistance - previous.close) / range < 0.12;

    if (
      nearSupport &&
      info.direction === "BUYER"
    ) {
      buy += 7;
      buyReasons.push(
        "Buyer rejection near support"
      );
    }

    if (
      nearResistance &&
      info.direction === "SELLER"
    ) {
      sell += 7;
      sellReasons.push(
        "Seller rejection near resistance"
      );
    }
  }

  const gap = Math.abs(buy - sell);

  let signal = "WAIT";
  let strength = "LOW";

  if (
    T === "UPTREND" &&
    buy >= 68 &&
    gap >= 24 &&
    P.label !== "STRONG SELLER" &&
    info.direction === "BUYER"
  ) {
    signal =
      buy >= 86 &&
      gap >= 38 &&
      P.label === "STRONG BUYER"
        ? "STRONG BUY"
        : "BUY";

    strength =
      signal === "STRONG BUY"
        ? "VERY HIGH"
        : "HIGH";
  } else if (
    T === "DOWNTREND" &&
    sell >= 68 &&
    gap >= 24 &&
    P.label !== "STRONG BUYER" &&
    info.direction === "SELLER"
  ) {
    signal =
      sell >= 86 &&
      gap >= 38 &&
      P.label === "STRONG SELLER"
        ? "STRONG SELL"
        : "SELL";

    strength =
      signal === "STRONG SELL"
        ? "VERY HIGH"
        : "HIGH";
  } else if (
    Math.max(buy, sell) >= 55 &&
    gap >= 12
  ) {
    strength = "MEDIUM";
  }

  const dominant =
    buy >= sell ? "BUY" : "SELL";

  const score = Math.round(
    clamp(
      50 + (buy - sell) * 0.55,
      0,
      100
    )
  );

  return {
    ok: true,
    signal,
    strength,
    score,
    buyScore: buy,
    sellScore: sell,
    confirmationGap: gap,
    dominant,

    price: rnd(live.close, 8),
    analyzedPrice: rnd(previous.close, 8),

    trend: T,
    pressure: P.label,
    pressureScore: rnd(P.score, 3),

    support: rnd(sr.support, 8),
    resistance: rnd(sr.resistance, 8),

    analyzedCandle:
      "PREVIOUS CLOSED CANDLE",

    targetCandle:
      "NEXT CANDLE",

    liveCandle: {
      datetime: live.datetime,
      open: rnd(live.open, 8),
      high: rnd(live.high, 8),
      low: rnd(live.low, 8),
      close: rnd(live.close, 8)
    },

    previousCandle: {
      datetime: previous.datetime,
      open: rnd(previous.open, 8),
      high: rnd(previous.high, 8),
      low: rnd(previous.low, 8),
      close: rnd(previous.close, 8),
      direction: info.direction,
      pattern: info.pattern,
      bodyRatio: rnd(info.bodyRatio, 3)
    },

    indicators: {
      rsi: rnd(R, 2),
      ema9: rnd(e9, 8),
      ema21: rnd(e21, 8),
      ema50: rnd(e50, 8),
      macd: rnd(M.line, 10),
      macdSignal: rnd(M.signal, 10),
      macdHistogram: rnd(M.histogram, 10),
      atr: rnd(A, 10),
      momentum: rnd(momentum, 2)
    },

    confirmations: {
      buy: buyReasons,
      sell: sellReasons
    },

    candleCount: candles.length,
    closedCandleCount: closed.length,

    warning:
      "Indicator-based analysis only. " +
      "Strength is not win probability and " +
      "no signal guarantees profit."
  };
}

async function getMarketData(request, env) {
  if (!env.TWELVE_DATA_API_KEY) {
    return json(
      {
        ok: false,
        source: "Cloudflare",
        error:
          "TWELVE_DATA_API_KEY secret is missing."
      },
      500
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        ok: false,
        source: "Cloudflare",
        error: "Invalid JSON body."
      },
      400
    );
  }

  const symbol =
    normalizeSymbol(body.symbol);

  const interval =
    String(
      body.interval || "1min"
    ).trim();

  const mode =
    String(
      body.mode || "REAL"
    ).toUpperCase();

  const outputsize = clamp(
    Number(body.outputsize) || 120,
    70,
    500
  );

  if (mode === "OTC") {
    return json(
      {
        ok: false,
        signal: "WAIT",
        mode: "OTC",
        error:
          "Verified Quotex OTC feed is not connected. " +
          "No fake OTC signal will be generated."
      },
      503
    );
  }

  if (!INTERVALS.has(interval)) {
    return json(
      {
        ok: false,
        source: "Cloudflare",
        error:
          `Unsupported interval: ${interval}`
      },
      400
    );
  }

  // Twelve Data recommends the Authorization header
  // for API-key authentication.
  const url =
    "https://api.twelvedata.com/time_series" +
    "?symbol=" +
    encodeURIComponent(symbol) +
    "&interval=" +
    encodeURIComponent(interval) +
    "&outputsize=" +
    outputsize +
    "&format=JSON";

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization":
          `apikey ${env.TWELVE_DATA_API_KEY}`,
        "Accept": "application/json"
      }
    });

    const rawText = await response.text();

    let data;

    try {
      data = JSON.parse(rawText);
    } catch {
      return json(
        {
          ok: false,
          source: "Twelve Data",
          error:
            "Twelve Data returned non-JSON data.",
          httpStatus: response.status
        },
        502
      );
    }

    if (
      !response.ok ||
      data.status === "error"
    ) {
      return json(
        {
          ok: false,
          source: "Twelve Data",
          httpStatus: response.status,
          code:
            data.code ||
            response.status,
          error:
            data.message ||
            "Twelve Data request failed."
        },
        response.status >= 400
          ? response.status
          : 502
      );
    }

    const candles =
      normalizeCandles(data.values);

    if (candles.length < 61) {
      return json(
        {
          ok: false,
          source: "Twelve Data",
          error:
            `Only ${candles.length} valid candles returned; ` +
            `at least 61 are required.`,
          symbol,
          interval
        },
        502
      );
    }

    const analysis =
      analyze(candles);

    if (!analysis.ok) {
      return json(
        {
          ok: false,
          source: "Analysis Engine",
          error: analysis.error
        },
        502
      );
    }

    return json({
      ok: true,
      app: APP,
      version: VERSION,
      source: "Twelve Data",
      mode: "REAL",
      symbol,
      interval,

      timezone:
        data.meta?.exchange_timezone ||
        data.meta?.timezone ||
        null,

      exchange:
        data.meta?.exchange ||
        null,

      analysis,

      livePrice:
        analysis.price,

      closedCandleCount:
        analysis.closedCandleCount,

      provider:
        "Twelve Data",

      candles:
        candles.slice(-120)
    });
  } catch (e) {
    return json(
      {
        ok: false,
        source: "Cloudflare",
        error:
          "Market request failed.",
        details:
          e?.message ||
          "Unknown network error"
      },
      502
    );
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS
      });
    }

    const url =
      new URL(request.url);

    // Health check
    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      return json({
        ok: true,
        app: APP,
        worker: "online",
        version: VERSION,
        provider: "Twelve Data",
        endpoints: {
          health: "GET /",
          debug: "GET /debug",
          market: "POST /market"
        },
        note:
          "Real market only. OTC is blocked " +
          "until a verified OTC feed exists."
      });
    }

    // Safe configuration check.
    // Never returns the actual secret.
    if (
      request.method === "GET" &&
      url.pathname === "/debug"
    ) {
      return json({
        ok: true,
        app: APP,
        version: VERSION,
        provider: "Twelve Data",
        twelveDataApiKeyConfigured:
          Boolean(env.TWELVE_DATA_API_KEY)
      });
    }

    if (
      request.method === "POST" &&
      url.pathname === "/market"
    ) {
      return getMarketData(
        request,
        env
      );
    }

    if (
      request.method === "POST" &&
      url.pathname === "/chat"
    ) {
      return json(
        {
          ok: false,
          available: false,
          message:
            "AI chat is disabled. " +
            "Market analysis works without a paid AI API."
        },
        503
      );
    }

    return json(
      {
        ok: false,
        error: "Endpoint not found."
      },
      404
    );
  }
};
