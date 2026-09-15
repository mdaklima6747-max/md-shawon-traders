// MD Shawon Traders — Worker v4.1.0
// Twelve Data connection + safe authentication test
// IMPORTANT: Never put the actual API key in this file.

const APP = "MD Shawon Traders";
const VERSION = "4.1.0";
const TWELVE_DATA_URL = "https://api.twelvedata.com/time_series";

const ALLOWED_ORIGINS = "*";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=utf-8"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: corsHeaders()
  });
}

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normalizeInterval(interval) {
  const map = {
    "1M": "1min",
    "1MIN": "1min",
    "1MINUTE": "1min",

    "5M": "5min",
    "5MIN": "5min",

    "15M": "15min",
    "15MIN": "15min",

    "30M": "30min",
    "30MIN": "30min",

    "45M": "45min",
    "45MIN": "45min",

    "1H": "1h",
    "1HR": "1h",
    "1HOUR": "1h",

    "2H": "2h",
    "4H": "4h",
    "8H": "8h",

    "1D": "1day",
    "1DAY": "1day",

    "1W": "1week",
    "1WEEK": "1week",

    "1MO": "1month",
    "1MONTH": "1month"
  };

  return map[String(interval || "").trim().toUpperCase()] || "1min";
}

function number(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function ema(values, period) {
  if (values.length < period) return null;

  const k = 2 / (period + 1);
  let value = average(values.slice(0, period));

  for (let i = period; i < values.length; i++) {
    value = values[i] * k + value * (1 - k);
  }

  return value;
}

function rsi(values, period = 14) {
  if (values.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];

    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;

  const trs = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );

    trs.push(tr);
  }

  return average(trs.slice(-period));
}

function macd(values) {
  if (values.length < 35) {
    return {
      macd: null,
      signal: null,
      histogram: null
    };
  }

  const macdSeries = [];

  for (let i = 26; i <= values.length; i++) {
    const slice = values.slice(0, i);
    const fast = ema(slice, 12);
    const slow = ema(slice, 26);

    if (fast !== null && slow !== null) {
      macdSeries.push(fast - slow);
    }
  }

  if (macdSeries.length < 9) {
    return {
      macd: null,
      signal: null,
      histogram: null
    };
  }

  const macdValue = macdSeries[macdSeries.length - 1];
  const signalValue = ema(macdSeries, 9);

  return {
    macd: macdValue,
    signal: signalValue,
    histogram:
      signalValue !== null ? macdValue - signalValue : null
  };
}

function candlePattern(candle, previous) {
  if (!candle || !previous) {
    return "NEUTRAL";
  }

  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;

  if (range <= 0) return "NEUTRAL";

  const upper = candle.high - Math.max(candle.open, candle.close);
  const lower = Math.min(candle.open, candle.close) - candle.low;

  // Bullish engulfing
  if (
    previous.close < previous.open &&
    candle.close > candle.open &&
    candle.open <= previous.close &&
    candle.close >= previous.open
  ) {
    return "BULLISH ENGULFING";
  }

  // Bearish engulfing
  if (
    previous.close > previous.open &&
    candle.close < candle.open &&
    candle.open >= previous.close &&
    candle.close <= previous.open
  ) {
    return "BEARISH ENGULFING";
  }

  // Hammer
  if (
    lower >= body * 2 &&
    upper <= body &&
    candle.close > candle.open
  ) {
    return "HAMMER";
  }

  // Shooting star
  if (
    upper >= body * 2 &&
    lower <= body &&
    candle.close < candle.open
  ) {
    return "SHOOTING STAR";
  }

  if (body / range >= 0.7 && candle.close > candle.open) {
    return "STRONG BULLISH";
  }

  if (body / range >= 0.7 && candle.close < candle.open) {
    return "STRONG BEARISH";
  }

  return "NEUTRAL";
}

function candleStrength(candle) {
  if (!candle) return "UNKNOWN";

  const range = candle.high - candle.low;
  if (range <= 0) return "WEAK";

  const body = Math.abs(candle.close - candle.open);
  const ratio = body / range;

  if (ratio >= 0.70) return "STRONG";
  if (ratio >= 0.45) return "MEDIUM";

  return "WEAK";
}

function candleDirection(candle) {
  if (!candle) return "NEUTRAL";

  if (candle.close > candle.open) return "BUYER";
  if (candle.close < candle.open) return "SELLER";

  return "NEUTRAL";
}

function momentum(values, lookback = 5) {
  if (values.length <= lookback) return null;

  const current = values[values.length - 1];
  const old = values[values.length - 1 - lookback];

  return current - old;
}

function supportResistance(candles) {
  const recent = candles.slice(-60);

  if (!recent.length) {
    return {
      support: null,
      resistance: null
    };
  }

  const lows = recent.map(x => x.low);
  const highs = recent.map(x => x.high);

  return {
    support: Math.min(...lows),
    resistance: Math.max(...highs)
  };
}

function pressure(candles) {
  const recent = candles.slice(-6);

  let buyers = 0;
  let sellers = 0;

  for (const candle of recent) {
    if (candle.close > candle.open) buyers++;
    if (candle.close < candle.open) sellers++;
  }

  if (buyers >= 4) return "BUYER PRESS";
  if (sellers >= 4) return "SELLER PRESS";

  return "NEUTRAL";
}

function trend(values) {
  const e9 = ema(values, 9);
  const e21 = ema(values, 21);
  const e50 = ema(values, 50);

  if (e9 === null || e21 === null || e50 === null) {
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

function analyze(closedCandles) {
  const closes = closedCandles.map(x => x.close);

  const last = closedCandles[closedCandles.length - 1];
  const previous = closedCandles[closedCandles.length - 2];

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);

  const rsiValue = rsi(closes, 14);
  const atrValue = atr(closedCandles, 14);
  const macdValue = macd(closes);

  const mom = momentum(closes, 5);
  const currentTrend = trend(closes);
  const currentPressure = pressure(closedCandles);

  const sr = supportResistance(closedCandles);

  const pattern = candlePattern(last, previous);
  const strength = candleStrength(last);
  const direction = candleDirection(last);

  let buyScore = 0;
  let sellScore = 0;

  const buyReasons = [];
  const sellReasons = [];

  // Trend
  if (currentTrend === "UPTREND") {
    buyScore += 20;
    buyReasons.push("UPTREND");
  }

  if (currentTrend === "DOWNTREND") {
    sellScore += 20;
    sellReasons.push("DOWNTREND");
  }

  // EMA alignment
  if (
    ema9 !== null &&
    ema21 !== null &&
    ema50 !== null &&
    ema9 > ema21 &&
    ema21 > ema50
  ) {
    buyScore += 15;
    buyReasons.push("EMA ALIGNMENT BUY");
  }

  if (
    ema9 !== null &&
    ema21 !== null &&
    ema50 !== null &&
    ema9 < ema21 &&
    ema21 < ema50
  ) {
    sellScore += 15;
    sellReasons.push("EMA ALIGNMENT SELL");
  }

  // Price vs EMA21
  if (ema21 !== null && last.close > ema21) {
    buyScore += 10;
    buyReasons.push("PRICE ABOVE EMA21");
  }

  if (ema21 !== null && last.close < ema21) {
    sellScore += 10;
    sellReasons.push("PRICE BELOW EMA21");
  }

  // RSI
  if (rsiValue !== null) {
    if (rsiValue >= 52 && rsiValue <= 68) {
      buyScore += 10;
      buyReasons.push("RSI BULLISH");
    }

    if (rsiValue >= 32 && rsiValue <= 48) {
      sellScore += 10;
      sellReasons.push("RSI BEARISH");
    }
  }

  // MACD
  if (
    macdValue.macd !== null &&
    macdValue.signal !== null
  ) {
    if (macdValue.macd > macdValue.signal) {
      buyScore += 10;
      buyReasons.push("MACD BULLISH");
    }

    if (macdValue.macd < macdValue.signal) {
      sellScore += 10;
      sellReasons.push("MACD BEARISH");
    }
  }

  // Momentum
  if (mom !== null) {
    if (mom > 0) {
      buyScore += 10;
      buyReasons.push("POSITIVE MOMENTUM");
    }

    if (mom < 0) {
      sellScore += 10;
      sellReasons.push("NEGATIVE MOMENTUM");
    }
  }

  // Pressure
  if (currentPressure === "BUYER PRESS") {
    buyScore += 10;
    buyReasons.push("BUYER PRESS");
  }

  if (currentPressure === "SELLER PRESS") {
    sellScore += 10;
    sellReasons.push("SELLER PRESS");
  }

  // Candle pattern
  if (
    pattern === "BULLISH ENGULFING" ||
    pattern === "HAMMER" ||
    pattern === "STRONG BULLISH"
  ) {
    buyScore += 10;
    buyReasons.push(pattern);
  }

  if (
    pattern === "BEARISH ENGULFING" ||
    pattern === "SHOOTING STAR" ||
    pattern === "STRONG BEARISH"
  ) {
    sellScore += 10;
    sellReasons.push(pattern);
  }

  // Previous candle confirmation
  const previousDirection = candleDirection(previous);
  const previousStrength = candleStrength(previous);

  let signal = "WAIT";

  const highest = Math.max(buyScore, sellScore);
  const difference = Math.abs(buyScore - sellScore);

  /*
    STRICT RULE:
    Weak/neutral previous candle cannot confirm a trade.
    Strong BUY/SELL requires high score + clear separation.
  */

  if (
    buyScore >= 70 &&
    buyScore > sellScore &&
    difference >= 25 &&
    previousDirection === "BUYER" &&
    previousStrength !== "WEAK"
  ) {
    signal = buyScore >= 85 ? "STRONG BUY" : "BUY";
  }

  if (
    sellScore >= 70 &&
    sellScore > buyScore &&
    difference >= 25 &&
    previousDirection === "SELLER" &&
    previousStrength !== "WEAK"
  ) {
    signal = sellScore >= 85 ? "STRONG SELL" : "SELL";
  }

  // Avoid trading sideways markets
  if (currentTrend === "SIDEWAYS") {
    signal = "WAIT";
  }

  // Avoid weak previous candle
  if (previousStrength === "WEAK") {
    signal = "WAIT";
  }

  return {
    signal,
    score: highest,
    buyScore,
    sellScore,

    trend: currentTrend,
    pressure: currentPressure,

    support: sr.support,
    resistance: sr.resistance,

    previousCandle: previousDirection,
    previousCandleStrength: previousStrength,

    candlePattern: pattern,
    candleStrength: strength,

    confirmations: {
      buy: buyReasons,
      sell: sellReasons
    },

    indicators: {
      rsi: rsiValue,
      ema9,
      ema21,
      ema50,
      macd: macdValue.macd,
      macdSignal: macdValue.signal,
      macdHistogram: macdValue.histogram,
      atr: atrValue,
      momentum: mom
    }
  };
}

async function twelveDataRequest(env, params) {
  const apiKey = env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      data: {
        code: "MISSING_SECRET",
        message: "TWELVE_DATA_API_KEY is not configured in Cloudflare."
      }
    };
  }

  const url = new URL(TWELVE_DATA_URL);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Authorization": `apikey ${apiKey}`,
      "Accept": "application/json"
    }
  });

  let data;

  try {
    data = await response.json();
  } catch {
    data = {
      code: "INVALID_PROVIDER_RESPONSE",
      message: "Twelve Data returned a non-JSON response."
    };
  }

  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

async function handleDebug(env) {
  return json({
    ok: true,
    app: APP,
    version: VERSION,
    provider: "Twelve Data",
    twelveDataApiKeyConfigured: Boolean(env.TWELVE_DATA_API_KEY)
  });
}

/*
  SAFE AUTH TEST
  Does NOT return the API key.
  It makes a tiny real request to Twelve Data.
*/
async function handleTestAuth(env) {
  const result = await twelveDataRequest(env, {
    symbol: "EUR/USD",
    interval: "1min",
    outputsize: "1"
  });

  if (result.ok && result.data && result.data.values) {
    return json({
      ok: true,
      authentication: "VALID",
      provider: "Twelve Data",
      message: "Twelve Data accepted the API key."
    });
  }

  const providerMessage =
    result.data?.message ||
    result.data?.error ||
    "Unknown Twelve Data error";

  if (result.status === 401) {
    return json({
      ok: false,
      authentication: "INVALID",
      provider: "Twelve Data",
      httpStatus: 401,
      message: "Twelve Data rejected the API key."
    }, 401);
  }

  return json({
    ok: false,
    authentication: "NOT_CONFIRMED",
    provider: "Twelve Data",
    httpStatus: result.status,
    message: providerMessage
  }, 502);
}

async function handleMarket(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      ok: false,
      error: "INVALID_JSON",
      message: "Request body must be valid JSON."
    }, 400);
  }

  const mode = String(body.mode || "REAL").toUpperCase();
  const symbol = normalizeSymbol(body.symbol || "EUR/USD");
  const interval = normalizeInterval(body.interval || "1min");

  // OTC is intentionally NOT faked.
  if (mode === "OTC" || mode === "QUOTEX OTC") {
    return json({
      ok: false,
      error: "OTC_DATA_UNAVAILABLE",
      message:
        "Reliable Quotex OTC feed is not connected. No fake OTC signal will be generated."
    }, 503);
  }

  const result = await twelveDataRequest(env, {
    symbol,
    interval,
    outputsize: "120"
  });

  if (!result.ok) {
    return json({
      ok: false,
      error: "TWELVE_DATA_ERROR",
      provider: "Twelve Data",
      httpStatus: result.status,
      code: result.data?.code ?? null,
      message:
        result.data?.message ||
        result.data?.error ||
        "Twelve Data request failed."
    }, 502);
  }

  if (!Array.isArray(result.data?.values)) {
    return json({
      ok: false,
      error: "NO_CANDLE_DATA",
      message: "Twelve Data returned no candle data."
    }, 502);
  }

  const candles = result.data.values
    .map(x => ({
      datetime: x.datetime,
      open: number(x.open),
      high: number(x.high),
      low: number(x.low),
      close: number(x.close),
      volume: number(x.volume)
    }))
    .filter(
      x =>
        x.open !== null &&
        x.high !== null &&
        x.low !== null &&
        x.close !== null
    )
    .reverse();

  if (candles.length < 61) {
    return json({
      ok: false,
      error: "INSUFFICIENT_CANDLES",
      message: `Only ${candles.length} valid candles received. At least 61 are required.`
    }, 502);
  }

  /*
    Latest candle may still be forming.
    We use it only as live/current price.
    Analysis uses previous closed candle.
  */

  const liveCandle = candles[candles.length - 1];
  const closedCandles = candles.slice(0, -1);

  const analysis = analyze(closedCandles);

  return json({
    ok: true,
    app: APP,
    version: VERSION,

    source: "Twelve Data",

    symbol,
    interval,
    mode: "REAL",

    livePrice: liveCandle.close,
    liveCandle,

    analyzedCandle: closedCandles[closedCandles.length - 1],
    closedCandleCount: closedCandles.length,

    analysis,

    warning:
      "Signal strength is indicator-based analysis only. It is not win probability and does not guarantee profit."
  });
}

async function handleChat() {
  return json({
    ok: false,
    error: "CHAT_DISABLED",
    message:
      "AI chat backend is currently disabled because no paid AI API credits are available."
  }, 503);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/") {
        return json({
          ok: true,
          app: APP,
          version: VERSION,
          provider: "Twelve Data",
          status: "online"
        });
      }

      if (request.method === "GET" && url.pathname === "/debug") {
        return handleDebug(env);
      }

      if (request.method === "GET" && url.pathname === "/test-auth") {
        return handleTestAuth(env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/market"
      ) {
        return handleMarket(request, env);
      }

      if (
        request.method === "POST" &&
        url.pathname === "/chat"
      ) {
        return handleChat();
      }

      return json({
        ok: false,
        error: "NOT_FOUND",
        message: "Endpoint not found."
      }, 404);

    } catch (error) {
      return json({
        ok: false,
        error: "WORKER_ERROR",
        message: error?.message || "Unknown Worker error."
      }, 500);
    }
  }
};
