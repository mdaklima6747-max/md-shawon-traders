const ALLOWED_ORIGINS = "*";

// ============================================================
// MD SHAWON TRADERS - FREE MARKET ANALYSIS ENGINE
// No paid AI required
// ============================================================

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

const MAX_CANDLES = 200;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normalizeCandles(values) {
  if (!Array.isArray(values)) return [];

  return values
    .map(x => ({
      datetime: x.datetime,
      open: Number(x.open),
      high: Number(x.high),
      low: Number(x.low),
      close: Number(x.close),
      volume: Number(x.volume || 0)
    }))
    .filter(x =>
      Number.isFinite(x.open) &&
      Number.isFinite(x.high) &&
      Number.isFinite(x.low) &&
      Number.isFinite(x.close)
    )
    .sort((a, b) =>
      new Date(a.datetime).getTime() -
      new Date(b.datetime).getTime()
    );
}

// ============================================================
// EMA
// ============================================================

function ema(values, period) {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);
  let result = values
    .slice(0, period)
    .reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < values.length; i++) {
    result =
      (values[i] - result) * multiplier +
      result;
  }

  return result;
}

// ============================================================
// RSI
// ============================================================

function rsi(values, period = 14) {
  if (values.length <= period) return null;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];

    if (change >= 0) gain += change;
    else loss += Math.abs(change);
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    const currentGain = change > 0 ? change : 0;
    const currentLoss = change < 0 ? Math.abs(change) : 0;

    avgGain =
      ((avgGain * (period - 1)) + currentGain) /
      period;

    avgLoss =
      ((avgLoss * (period - 1)) + currentLoss) /
      period;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;

  return 100 - (100 / (1 + rs));
}

// ============================================================
// ATR
// ============================================================

function atr(candles, period = 14) {
  if (candles.length <= period) return null;

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

  if (trs.length < period) return null;

  let value =
    trs.slice(0, period).reduce((a, b) => a + b, 0) /
    period;

  for (let i = period; i < trs.length; i++) {
    value =
      ((value * (period - 1)) + trs[i]) /
      period;
  }

  return value;
}

// ============================================================
// MACD
// ============================================================

function macd(values) {
  if (values.length < 35) return null;

  const fast = 12;
  const slow = 26;
  const signalPeriod = 9;

  const fastValues = [];
  const slowValues = [];

  let fastEma = null;
  let slowEma = null;

  const fastMultiplier = 2 / (fast + 1);
  const slowMultiplier = 2 / (slow + 1);

  for (let i = 0; i < values.length; i++) {

    if (i === fast - 1) {
      fastEma =
        values.slice(0, fast)
          .reduce((a, b) => a + b, 0) / fast;
    } else if (i >= fast) {
      fastEma =
        (values[i] - fastEma) *
        fastMultiplier +
        fastEma;
    }

    if (i === slow - 1) {
      slowEma =
        values.slice(0, slow)
          .reduce((a, b) => a + b, 0) / slow;
    } else if (i >= slow) {
      slowEma =
        (values[i] - slowEma) *
        slowMultiplier +
        slowEma;
    }

    if (fastEma !== null && slowEma !== null) {
      fastValues.push(fastEma);
      slowValues.push(slowEma);
    }
  }

  const macdLine = [];

  for (let i = 0; i < fastValues.length; i++) {
    macdLine.push(
      fastValues[i] - slowValues[i]
    );
  }

  if (macdLine.length < signalPeriod) return null;

  let signal =
    macdLine.slice(0, signalPeriod)
      .reduce((a, b) => a + b, 0) /
    signalPeriod;

  const multiplier = 2 / (signalPeriod + 1);

  for (let i = signalPeriod; i < macdLine.length; i++) {
    signal =
      (macdLine[i] - signal) *
      multiplier +
      signal;
  }

  const line =
    macdLine[macdLine.length - 1];

  return {
    line,
    signal,
    histogram: line - signal
  };
}

// ============================================================
// SUPPORT / RESISTANCE
// ============================================================

function supportResistance(candles, lookback = 30) {
  const recent = candles.slice(-lookback);

  if (!recent.length) {
    return {
      support: null,
      resistance: null
    };
  }

  const support = Math.min(
    ...recent.map(c => c.low)
  );

  const resistance = Math.max(
    ...recent.map(c => c.high)
  );

  return {
    support,
    resistance
  };
}

// ============================================================
// CANDLE PRESSURE
// ============================================================

function candlePressure(candles, count = 5) {
  const recent = candles.slice(-count);

  let buyers = 0;
  let sellers = 0;

  for (const c of recent) {
    const range = c.high - c.low;

    if (range <= 0) continue;

    const body = Math.abs(c.close - c.open);
    const bodyRatio = body / range;

    if (c.close > c.open) {
      buyers += bodyRatio;
    } else if (c.close < c.open) {
      sellers += bodyRatio;
    }
  }

  if (buyers > sellers * 1.25) {
    return "BUYER";
  }

  if (sellers > buyers * 1.25) {
    return "SELLER";
  }

  return "BALANCED";
}

// ============================================================
// TREND
// ============================================================

function trendDirection(values) {
  const ema9 = ema(values, 9);
  const ema21 = ema(values, 21);
  const ema50 = ema(values, 50);

  if (ema9 === null || ema21 === null) {
    return "UNKNOWN";
  }

  if (
    ema9 > ema21 &&
    (ema50 === null || ema21 > ema50)
  ) {
    return "UPTREND";
  }

  if (
    ema9 < ema21 &&
    (ema50 === null || ema21 < ema50)
  ) {
    return "DOWNTREND";
  }

  return "SIDEWAYS";
}

// ============================================================
// CANDLE PATTERN
// ============================================================

function candlePattern(candles) {
  if (candles.length < 3) return "NONE";

  const c1 = candles[candles.length - 1];
  const c2 = candles[candles.length - 2];

  const body = Math.abs(c1.close - c1.open);
  const range = c1.high - c1.low;

  if (range <= 0) return "NONE";

  const upperWick =
    c1.high - Math.max(c1.open, c1.close);

  const lowerWick =
    Math.min(c1.open, c1.close) - c1.low;

  if (
    lowerWick > body * 2 &&
    lowerWick > upperWick
  ) {
    return "BULLISH_REJECTION";
  }

  if (
    upperWick > body * 2 &&
    upperWick > lowerWick
  ) {
    return "BEARISH_REJECTION";
  }

  if (
    c1.close > c1.open &&
    c2.close < c2.open &&
    c1.close > c2.open &&
    c1.open < c2.close
  ) {
    return "BULLISH_ENGULFING";
  }

  if (
    c1.close < c1.open &&
    c2.close > c2.open &&
    c1.open > c2.close &&
    c1.close < c2.open
  ) {
    return "BEARISH_ENGULFING";
  }

  return "NONE";
}

// ============================================================
// MOMENTUM
// ============================================================

function momentum(values, period = 5) {
  if (values.length <= period) return null;

  const current =
    values[values.length - 1];

  const previous =
    values[values.length - 1 - period];

  return current - previous;
}

// ============================================================
// MAIN ANALYSIS
// ============================================================

function analyzeMarket(candles) {

  if (candles.length < 60) {
    return {
      ready: false,
      signal: "WAIT",
      reason: "Not enough candle data"
    };
  }

  const closes =
    candles.map(c => c.close);

  const price =
    closes[closes.length - 1];

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);

  const rsiValue =
    rsi(closes, 14);

  const atrValue =
    atr(candles, 14);

  const macdValue =
    macd(closes);

  const sr =
    supportResistance(candles, 30);

  const pressure =
    candlePressure(candles, 5);

  const trend =
    trendDirection(closes);

  const pattern =
    candlePattern(candles);

  const mom =
    momentum(closes, 5);

  // ----------------------------------------------------------
  // CONFIRMATION SCORE
  // ----------------------------------------------------------

  let score = 50;

  const reasons = [];

  // TREND
  if (trend === "UPTREND") {
    score += 12;
    reasons.push("Strong bullish trend");
  }

  if (trend === "DOWNTREND") {
    score -= 12;
    reasons.push("Strong bearish trend");
  }

  // EMA
  if (ema9 > ema21) {
    score += 8;
    reasons.push("EMA bullish");
  }

  if (ema9 < ema21) {
    score -= 8;
    reasons.push("EMA bearish");
  }

  // RSI
  if (rsiValue >= 52 && rsiValue <= 68) {
    score += 7;
    reasons.push("RSI supports buyers");
  }

  if (rsiValue <= 48 && rsiValue >= 32) {
    score -= 7;
    reasons.push("RSI supports sellers");
  }

  // Avoid blindly buying overbought
  if (rsiValue > 72) {
    score -= 8;
    reasons.push("RSI overbought warning");
  }

  // Avoid blindly selling oversold
  if (rsiValue < 28) {
    score += 8;
    reasons.push("RSI oversold warning");
  }

  // MACD
  if (macdValue) {

    if (
      macdValue.line > macdValue.signal &&
      macdValue.histogram > 0
    ) {
      score += 10;
      reasons.push("MACD bullish confirmation");
    }

    if (
      macdValue.line < macdValue.signal &&
      macdValue.histogram < 0
    ) {
      score -= 10;
      reasons.push("MACD bearish confirmation");
    }
  }

  // BUYER / SELLER PRESSURE
  if (pressure === "BUYER") {
    score += 8;
    reasons.push("Recent candle buyer pressure");
  }

  if (pressure === "SELLER") {
    score -= 8;
    reasons.push("Recent candle seller pressure");
  }

  // MOMENTUM
  if (mom !== null) {

    if (mom > 0) {
      score += 5;
      reasons.push("Positive momentum");
    }

    if (mom < 0) {
      score -= 5;
      reasons.push("Negative momentum");
    }
  }

  // CANDLE PATTERN
  if (
    pattern === "BULLISH_ENGULFING" ||
    pattern === "BULLISH_REJECTION"
  ) {
    score += 8;
    reasons.push("Bullish candle pattern");
  }

  if (
    pattern === "BEARISH_ENGULFING" ||
    pattern === "BEARISH_REJECTION"
  ) {
    score -= 8;
    reasons.push("Bearish candle pattern");
  }

  // SUPPORT / RESISTANCE
  const range =
    sr.resistance - sr.support;

  if (range > 0) {

    const distanceFromSupport =
      Math.abs(price - sr.support);

    const distanceFromResistance =
      Math.abs(sr.resistance - price);

    const supportZone =
      range * 0.10;

    const resistanceZone =
      range * 0.10;

    if (
      distanceFromSupport <= supportZone &&
      pressure === "BUYER"
    ) {
      score += 8;
      reasons.push("Support rejection with buyers");
    }

    if (
      distanceFromResistance <= resistanceZone &&
      pressure === "SELLER"
    ) {
      score -= 8;
      reasons.push("Resistance rejection with sellers");
    }
  }

  // ----------------------------------------------------------
  // LIMIT SCORE
  // ----------------------------------------------------------

  score =
    Math.max(0, Math.min(100, score));

  // ----------------------------------------------------------
  // SIGNAL FILTER
  // ----------------------------------------------------------

  let signal = "WAIT";
  let strength = "LOW";

  // IMPORTANT:
  // Weak setups NEVER become BUY/SELL.

  if (
    score >= 82 &&
    trend === "UPTREND" &&
    pressure === "BUYER" &&
    macdValue &&
    macdValue.histogram > 0
  ) {
    signal = "STRONG BUY";
    strength = "VERY HIGH";
  }

  else if (
    score >= 70 &&
    trend === "UPTREND" &&
    pressure !== "SELLER"
  ) {
    signal = "BUY";
    strength = "HIGH";
  }

  else if (
    score <= 18 &&
    trend === "DOWNTREND" &&
    pressure === "SELLER" &&
    macdValue &&
    macdValue.histogram < 0
  ) {
    signal = "STRONG SELL";
    strength = "VERY HIGH";
  }

  else if (
    score <= 30 &&
    trend === "DOWNTREND" &&
    pressure !== "BUYER"
  ) {
    signal = "SELL";
    strength = "HIGH";
  }

  // SIDEWAYS MARKET FILTER
  if (trend === "SIDEWAYS") {
    signal = "WAIT";
    strength = "LOW";
    reasons.push("Sideways market - confirmation insufficient");
  }

  // EXTREME RSI FILTER
  if (
    signal === "BUY" ||
    signal === "STRONG BUY"
  ) {
    if (rsiValue > 78) {
      signal = "WAIT";
      strength = "LOW";
      reasons.push("Buy blocked by extreme RSI");
    }
  }

  if (
    signal === "SELL" ||
    signal === "STRONG SELL"
  ) {
    if (rsiValue < 22) {
      signal = "WAIT";
      strength = "LOW";
      reasons.push("Sell blocked by extreme RSI");
    }
  }

  return {
    ready: true,
    signal,
    strength,
    score,
    price,
    trend,
    indicators: {
      RSI: Number(rsiValue?.toFixed(2)),
      EMA9: Number(ema9?.toFixed(6)),
      EMA21: Number(ema21?.toFixed(6)),
      EMA50: ema50
        ? Number(ema50.toFixed(6))
        : null,
      MACD: macdValue
        ? {
            line: Number(macdValue.line.toFixed(6)),
            signal: Number(macdValue.signal.toFixed(6)),
            histogram: Number(
              macdValue.histogram.toFixed(6)
            )
          }
        : null,
      ATR: atrValue
        ? Number(atrValue.toFixed(6))
        : null,
      momentum: mom
        ? Number(mom.toFixed(6))
        : 0,
      support: sr.support,
      resistance: sr.resistance,
      candlePressure: pressure,
      candlePattern: pattern
    },
    reasons: reasons.slice(0, 10),
    warning:
      "Indicator-based analysis only. No signal can guarantee profit or a winning trade."
  };
}

// ============================================================
// TWELVE DATA MARKET DATA
// ============================================================

async function getMarketData(env, symbol, interval) {

  if (!env.TWELVE_DATA_API_KEY) {
    throw new Error(
      "TWELVE_DATA_API_KEY secret is missing"
    );
  }

  const url =
    "https://api.twelvedata.com/time_series" +
    "?symbol=" +
    encodeURIComponent(symbol) +
    "&interval=" +
    encodeURIComponent(interval) +
    "&outputsize=200" +
    "&apikey=" +
    encodeURIComponent(
      env.TWELVE_DATA_API_KEY
    );

  const response =
    await fetch(url);

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.message ||
      "Market data request failed"
    );
  }

  if (
    data.status === "error" ||
    !Array.isArray(data.values)
  ) {
    throw new Error(
      data?.message ||
      "No market data available"
    );
  }

  return normalizeCandles(data.values);
}

// ============================================================
// REQUEST HANDLER
// ============================================================

export default {

  async fetch(request, env) {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    const url =
      new URL(request.url);

    // --------------------------------------------------------
    // HOME
    // --------------------------------------------------------

    if (
      request.method === "GET" &&
      url.pathname === "/"
    ) {
      return json({
        ok: true,
        app: "MD Shawon Traders",
        version: "2.0.0",
        mode: "FREE ANALYSIS ENGINE",
        endpoints: {
          health: "GET /",
          market: "POST /market",
          chat: "POST /chat"
        }
      });
    }

    // --------------------------------------------------------
    // MARKET ANALYSIS
    // --------------------------------------------------------

    if (
      request.method === "POST" &&
      url.pathname === "/market"
    ) {

      try {

        const body =
          await request.json();

        const symbol =
          normalizeSymbol(body.symbol);

        const interval =
          String(
            body.interval || "1min"
          );

        const mode =
          String(
            body.mode || "REAL"
          ).toUpperCase();

        if (!symbol) {
          return json({
            ok: false,
            error: "Symbol is required"
          }, 400);
        }

        if (!INTERVALS.has(interval)) {
          return json({
            ok: false,
            error: "Invalid interval"
          }, 400);
        }

        // ----------------------------------------------------
        // OTC SAFETY
        // ----------------------------------------------------

        if (mode === "OTC") {

          return json({
            ok: false,
            mode: "OTC",
            signal: "WAIT",
            error:
              "Exact Quotex OTC feed is not available from the current free data source. No fake OTC signal will be generated."
          }, 503);
        }

        // ----------------------------------------------------
        // REAL MARKET
        // ----------------------------------------------------

        const candles =
          await getMarketData(
            env,
            symbol,
            interval
          );

        const analysis =
          analyzeMarket(candles);

        return json({
          ok: true,
          app: "MD Shawon Traders",
          mode: "REAL",
          symbol,
          interval,
          analysis,
          candles: candles.slice(-100)
        });

      } catch (error) {

        return json({
          ok: false,
          signal: "WAIT",
          error:
            error?.message ||
            "Market analysis failed"
        }, 500);
      }
    }

    // --------------------------------------------------------
    // CHAT
    // --------------------------------------------------------

    if (
      request.method === "POST" &&
      url.pathname === "/chat"
    ) {

      return json({
        ok: false,
        enabled: false,
        message:
          "AI chat is temporarily disabled because the free analysis engine is being used without paid AI API credits."
      }, 503);
    }

    return json({
      ok: false,
      error: "Not found"
    }, 404);
  }
};
