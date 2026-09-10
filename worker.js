const ALLOWED_ORIGINS = "*";

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

// ============================================================
// MD SHAWON TRADERS
// Free Market Analysis Engine
// Version 2.1.0
// ============================================================

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "access-control-allow-origin": ALLOWED_ORIGINS,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "Content-Type"
    }
  });
}

function cors() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": ALLOWED_ORIGINS,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "Content-Type"
    }
  });
}

// ============================================================
// BASIC HELPERS
// ============================================================

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round(v, digits = 5) {
  if (!Number.isFinite(v)) return null;
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}

// ============================================================
// CANDLE NORMALIZATION
// ============================================================

function normalizeCandles(values) {
  if (!Array.isArray(values)) return [];

  return values
    .map(x => ({
      datetime: x.datetime || "",
      open: num(x.open),
      high: num(x.high),
      low: num(x.low),
      close: num(x.close),
      volume: num(x.volume) || 0
    }))
    .filter(x =>
      x.open !== null &&
      x.high !== null &&
      x.low !== null &&
      x.close !== null
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
  if (!values.length) return null;

  const k = 2 / (period + 1);
  let result = values[0];

  for (let i = 1; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }

  return result;
}

// ============================================================
// RSI
// ============================================================

function rsi(values, period = 14) {
  if (values.length < period + 1) return 50;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];

    if (change >= 0) {
      gain += change;
    } else {
      loss += Math.abs(change);
    }
  }

  gain /= period;
  loss /= period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    const currentGain = change > 0 ? change : 0;
    const currentLoss = change < 0 ? Math.abs(change) : 0;

    gain = ((gain * (period - 1)) + currentGain) / period;
    loss = ((loss * (period - 1)) + currentLoss) / period;
  }

  if (loss === 0) return 100;

  const rs = gain / loss;
  return 100 - (100 / (1 + rs));
}

// ============================================================
// ATR
// ============================================================

function atr(candles, period = 14) {
  if (candles.length < 2) return 0;

  const trs = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];

    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );

    trs.push(tr);
  }

  if (!trs.length) return 0;

  const start = Math.max(0, trs.length - period);
  const recent = trs.slice(start);

  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

// ============================================================
// MACD
// ============================================================

function macd(values) {
  if (values.length < 35) {
    return {
      macd: 0,
      signal: 0,
      histogram: 0
    };
  }

  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);

  const macdLine = ema12 - ema26;

  // Approximation of signal line using current MACD relationship.
  // This is intentionally conservative.
  const signalLine = macdLine * 0.8;

  return {
    macd: macdLine,
    signal: signalLine,
    histogram: macdLine - signalLine
  };
}

// ============================================================
// SUPPORT / RESISTANCE
// ============================================================

function supportResistance(candles) {
  const recent = candles.slice(-30);

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

// ============================================================
// CANDLE PRESSURE
// ============================================================

function candlePressure(candles) {
  const recent = candles.slice(-5);

  let buyer = 0;
  let seller = 0;

  for (const c of recent) {
    if (c.close > c.open) buyer++;
    if (c.close < c.open) seller++;
  }

  let pressure = "NEUTRAL";

  if (buyer >= 4) pressure = "STRONG BUYER";
  else if (seller >= 4) pressure = "STRONG SELLER";
  else if (buyer > seller) pressure = "BUYER";
  else if (seller > buyer) pressure = "SELLER";

  return {
    buyer,
    seller,
    pressure
  };
}

// ============================================================
// TREND
// ============================================================

function trend(values) {
  const e9 = ema(values, 9);
  const e21 = ema(values, 21);
  const e50 = ema(values, 50);

  if (e9 === null || e21 === null || e50 === null) {
    return {
      direction: "UNKNOWN",
      ema9: e9,
      ema21: e21,
      ema50: e50
    };
  }

  if (e9 > e21 && e21 > e50) {
    return {
      direction: "UPTREND",
      ema9: e9,
      ema21: e21,
      ema50: e50
    };
  }

  if (e9 < e21 && e21 < e50) {
    return {
      direction: "DOWNTREND",
      ema9: e9,
      ema21: e21,
      ema50: e50
    };
  }

  return {
    direction: "SIDEWAYS",
    ema9: e9,
    ema21: e21,
    ema50: e50
  };
}

// ============================================================
// CANDLE PATTERNS
// ============================================================

function candlePatterns(candles) {
  if (candles.length < 3) {
    return {
      bullishRejection: false,
      bearishRejection: false,
      bullishEngulfing: false,
      bearishEngulfing: false
    };
  }

  const a = candles[candles.length - 2];
  const b = candles[candles.length - 1];

  const aBody = Math.abs(a.close - a.open);
  const bBody = Math.abs(b.close - b.open);

  const bUpper = b.high - Math.max(b.open, b.close);
  const bLower = Math.min(b.open, b.close) - b.low;

  const bullishRejection =
    bLower > bBody * 1.5 &&
    b.close > b.open;

  const bearishRejection =
    bUpper > bBody * 1.5 &&
    b.close < b.open;

  const bullishEngulfing =
    a.close < a.open &&
    b.close > b.open &&
    b.open <= a.close &&
    b.close >= a.open;

  const bearishEngulfing =
    a.close > a.open &&
    b.close < b.open &&
    b.open >= a.close &&
    b.close <= a.open;

  return {
    bullishRejection,
    bearishRejection,
    bullishEngulfing,
    bearishEngulfing
  };
}

// ============================================================
// MOMENTUM
// ============================================================

function momentum(values) {
  if (values.length < 6) return 0;

  const current = values[values.length - 1];
  const previous = values[values.length - 6];

  if (!previous) return 0;

  return current - previous;
}

// ============================================================
// MAIN ANALYSIS ENGINE
// ============================================================

function analyze(candles, symbol, interval, mode) {
  if (candles.length < 60) {
    return {
      ok: false,
      error: "Not enough candle data for reliable analysis."
    };
  }

  const closes = candles.map(x => x.close);
  const current = closes[closes.length - 1];

  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);

  const rsiValue = rsi(closes, 14);
  const atrValue = atr(candles, 14);
  const macdValue = macd(closes);

  const sr = supportResistance(candles);
  const pressure = candlePressure(candles);
  const tr = trend(closes);
  const patterns = candlePatterns(candles);
  const mom = momentum(closes);

  let score = 50;
  const reasons = [];

  // ----------------------------------------------------------
  // TREND
  // ----------------------------------------------------------

  if (tr.direction === "UPTREND") {
    score += 12;
    reasons.push("EMA trend is bullish");
  }

  if (tr.direction === "DOWNTREND") {
    score -= 12;
    reasons.push("EMA trend is bearish");
  }

  // ----------------------------------------------------------
  // EMA
  // ----------------------------------------------------------

  if (e9 > e21) {
    score += 8;
    reasons.push("EMA9 above EMA21");
  }

  if (e9 < e21) {
    score -= 8;
    reasons.push("EMA9 below EMA21");
  }

  // ----------------------------------------------------------
  // RSI
  // ----------------------------------------------------------

  if (rsiValue >= 52 && rsiValue <= 68) {
    score += 7;
    reasons.push("RSI supports bullish momentum");
  }

  if (rsiValue >= 32 && rsiValue <= 48) {
    score -= 7;
    reasons.push("RSI supports bearish momentum");
  }

  // ----------------------------------------------------------
  // MACD
  // ----------------------------------------------------------

  if (macdValue.histogram > 0) {
    score += 10;
    reasons.push("MACD momentum is positive");
  }

  if (macdValue.histogram < 0) {
    score -= 10;
    reasons.push("MACD momentum is negative");
  }

  // ----------------------------------------------------------
  // CANDLE PRESSURE
  // ----------------------------------------------------------

  if (pressure.pressure === "STRONG BUYER") {
    score += 8;
    reasons.push("Recent candles show strong buyer pressure");
  } else if (pressure.pressure === "BUYER") {
    score += 4;
    reasons.push("Recent candles show buyer pressure");
  }

  if (pressure.pressure === "STRONG SELLER") {
    score -= 8;
    reasons.push("Recent candles show strong seller pressure");
  } else if (pressure.pressure === "SELLER") {
    score -= 4;
    reasons.push("Recent candles show seller pressure");
  }

  // ----------------------------------------------------------
  // MOMENTUM
  // ----------------------------------------------------------

  if (mom > 0) {
    score += 5;
    reasons.push("Short-term momentum is positive");
  }

  if (mom < 0) {
    score -= 5;
    reasons.push("Short-term momentum is negative");
  }

  // ----------------------------------------------------------
  // CANDLE PATTERNS
  // ----------------------------------------------------------

  if (patterns.bullishRejection || patterns.bullishEngulfing) {
    score += 8;
    reasons.push("Bullish candle pattern detected");
  }

  if (patterns.bearishRejection || patterns.bearishEngulfing) {
    score -= 8;
    reasons.push("Bearish candle pattern detected");
  }

  // ----------------------------------------------------------
  // SUPPORT / RESISTANCE
  // ----------------------------------------------------------

  let nearSupport = false;
  let nearResistance = false;

  if (sr.support !== null && sr.resistance !== null) {
    const range = Math.max(sr.resistance - sr.support, 0);

    if (range > 0) {
      nearSupport =
        Math.abs(current - sr.support) <= range * 0.12;

      nearResistance =
        Math.abs(current - sr.resistance) <= range * 0.12;
    }
  }

  if (nearSupport) {
    score += 8;
    reasons.push("Price is near recent support");
  }

  if (nearResistance) {
    score -= 8;
    reasons.push("Price is near recent resistance");
  }

  // ----------------------------------------------------------
  // CLAMP SCORE
  // ----------------------------------------------------------

  score = clamp(Math.round(score), 0, 100);

  // ----------------------------------------------------------
  // SIGNAL DECISION
  // ----------------------------------------------------------

  let signal = "WAIT";
  let strength = "LOW";

  // Extreme RSI = avoid chasing
  const extremeOverbought = rsiValue >= 75;
  const extremeOversold = rsiValue <= 25;

  if (
    !extremeOverbought &&
    score >= 82 &&
    tr.direction === "UPTREND" &&
    pressure.pressure === "STRONG BUYER" &&
    macdValue.histogram > 0
  ) {
    signal = "STRONG BUY";
    strength = "VERY HIGH";
  } else if (
    !extremeOverbought &&
    score >= 70 &&
    tr.direction === "UPTREND" &&
    pressure.pressure !== "STRONG SELLER"
  ) {
    signal = "BUY";
    strength = "HIGH";
  } else if (
    !extremeOversold &&
    score <= 18 &&
    tr.direction === "DOWNTREND" &&
    pressure.pressure === "STRONG SELLER" &&
    macdValue.histogram < 0
  ) {
    signal = "STRONG SELL";
    strength = "VERY HIGH";
  } else if (
    !extremeOversold &&
    score <= 30 &&
    tr.direction === "DOWNTREND" &&
    pressure.pressure !== "STRONG BUYER"
  ) {
    signal = "SELL";
    strength = "HIGH";
  }

  // Sideways market = WAIT
  if (tr.direction === "SIDEWAYS") {
    signal = "WAIT";
    strength = "LOW";
  }

  // Extreme RSI protection
  if (extremeOverbought && signal.includes("BUY")) {
    signal = "WAIT";
    strength = "LOW";
    reasons.push("RSI is extremely overbought");
  }

  if (extremeOversold && signal.includes("SELL")) {
    signal = "WAIT";
    strength = "LOW";
    reasons.push("RSI is extremely oversold");
  }

  return {
    ok: true,
    app: "MD Shawon Traders",
    version: "2.1.0",

    symbol,
    interval,
    mode,

    signal,
    strength,
    score,

    price: round(current),

    indicators: {
      RSI: round(rsiValue, 2),
      EMA9: round(e9),
      EMA21: round(e21),
      EMA50: round(e50),
      ATR: round(atrValue),
      MACD: round(macdValue.macd),
      MACDSignal: round(macdValue.signal),
      MACDHistogram: round(macdValue.histogram)
    },

    trend: tr.direction,

    candlePressure: pressure.pressure,

    support: round(sr.support),
    resistance: round(sr.resistance),

    patterns,

    momentum: round(mom),

    reasons: reasons.slice(0, 10),

    warning:
      "This is indicator-based market analysis, not a guarantee of profit or win probability."
  };
}

// ============================================================
// TWELVE DATA
// ============================================================

async function getTwelveDataCandles(env, symbol, interval) {
  const apiKey =
    typeof env.TWELVE_DATA_API_KEY === "string"
      ? env.TWELVE_DATA_API_KEY.trim()
      : "";

  if (!apiKey) {
    throw new Error("TWELVE_DATA_API_KEY is not configured.");
  }

  const endpoint =
    "https://api.twelvedata.com/time_series";

  const params = new URLSearchParams();

  params.set("symbol", symbol);
  params.set("interval", interval);
  params.set("outputsize", "200");
  params.set("apikey", apiKey);

  const response = await fetch(
    endpoint + "?" + params.toString(),
    {
      method: "GET",
      headers: {
        "accept": "application/json"
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.message ||
      `Twelve Data HTTP ${response.status}`
    );
  }

  if (
    data?.status === "error" ||
    data?.code ||
    !Array.isArray(data?.values)
  ) {
    throw new Error(
      data?.message ||
      "Twelve Data did not return candle data."
    );
  }

  return normalizeCandles(data.values);
}

// ============================================================
// REQUEST BODY
// ============================================================

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// ============================================================
// WORKER
// ============================================================

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return cors();
      }

      const url = new URL(request.url);

      // --------------------------------------------------------
      // HOME
      // --------------------------------------------------------

      if (
        request.method === "GET" &&
        (url.pathname === "/" || url.pathname === "")
      ) {
        return json({
          ok: true,
          app: "MD Shawon Traders",
          version: "2.1.0",
          mode: "FREE ANALYSIS ENGINE",
          endpoints: [
            "/",
            "/debug",
            "/market"
          ],
          message:
            "MD Shawon Traders backend is running."
        });
      }

      // --------------------------------------------------------
      // DEBUG
      // IMPORTANT:
      // NEVER returns the actual API key.
      // --------------------------------------------------------

      if (
        request.method === "GET" &&
        url.pathname === "/debug"
      ) {
        const configured =
          typeof env.TWELVE_DATA_API_KEY === "string" &&
          env.TWELVE_DATA_API_KEY.trim().length > 0;

        return json({
          ok: true,
          app: "MD Shawon Traders",
          version: "2.1.0",
          twelveDataApiKeyConfigured: configured
        });
      }

      // --------------------------------------------------------
      // MARKET ANALYSIS
      // --------------------------------------------------------

      if (
        request.method === "POST" &&
        url.pathname === "/market"
      ) {
        const body = await readBody(request);

        const symbol =
          typeof body.symbol === "string"
            ? body.symbol.trim()
            : "";

        const interval =
          typeof body.interval === "string"
            ? body.interval.trim()
            : "1min";

        const mode =
          typeof body.mode === "string"
            ? body.mode.trim().toUpperCase()
            : "REAL";

        if (!symbol) {
          return json(
            {
              ok: false,
              error: "Symbol is required."
            },
            400
          );
        }

        if (!INTERVALS.has(interval)) {
          return json(
            {
              ok: false,
              error: "Unsupported interval.",
              allowedIntervals: Array.from(INTERVALS)
            },
            400
          );
        }

        // ------------------------------------------------------
        // OTC
        // ------------------------------------------------------

        if (mode === "OTC") {
          return json(
            {
              ok: false,
              signal: "WAIT",
              mode: "OTC",
              error:
                "Exact Quotex OTC feed is not available from the current verified data source. No fake OTC signal will be generated."
            },
            503
          );
        }

        // ------------------------------------------------------
        // REAL MARKET
        // ------------------------------------------------------

        const candles =
          await getTwelveDataCandles(
            env,
            symbol,
            interval
          );

        const result =
          analyze(
            candles,
            symbol,
            interval,
            "REAL"
          );

        if (!result.ok) {
          return json(
            result,
            422
          );
        }

        return json({
          ...result,
          candlesUsed: candles.length,
          dataSource: "Twelve Data"
        });
      }

      // --------------------------------------------------------
      // CHAT DISABLED
      // No paid AI API required for this version.
      // --------------------------------------------------------

      if (
        request.method === "POST" &&
        url.pathname === "/chat"
      ) {
        return json(
          {
            ok: false,
            error:
              "AI chat is disabled in this free version. Market analysis works without a paid AI API."
          },
          503
        );
      }

      // --------------------------------------------------------
      // NOT FOUND
      // --------------------------------------------------------

      return json(
        {
          ok: false,
          error: "Endpoint not found."
        },
        404
      );

    } catch (error) {
      return json(
        {
          ok: false,
          signal: "WAIT",
          error:
            error?.message ||
            "Unexpected server error."
        },
        500
      );
    }
  }
};
