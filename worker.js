const APP = "MD Shawon Traders";
const VERSION = "2.3.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS
    }
  });
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function rnd(x, digits = 6) {
  if (!Number.isFinite(x)) return null;
  const p = 10 ** digits;
  return Math.round(x * p) / p;
}

/* =========================
   INDICATORS
========================= */

function ema(values, period) {
  if (values.length === 0) return [];

  const result = [];
  const k = 2 / (period + 1);

  result.push(values[0]);

  for (let i = 1; i < values.length; i++) {
    result.push(
      values[i] * k +
      result[i - 1] * (1 - k)
    );
  }

  return result;
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];

    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    avgGain =
      (avgGain * (period - 1) + gain) /
      period;

    avgLoss =
      (avgLoss * (period - 1) + loss) /
      period;
  }

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
}

function atr(candles, period = 14) {
  if (candles.length <= period) return null;

  const trueRanges = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    const tr = Math.max(
      current.high - current.low,
      Math.abs(
        current.high - previous.close
      ),
      Math.abs(
        current.low - previous.close
      )
    );

    if (Number.isFinite(tr)) {
      trueRanges.push(tr);
    }
  }

  if (trueRanges.length < period) return null;

  return (
    trueRanges
      .slice(-period)
      .reduce((a, b) => a + b, 0) /
    period
  );
}

function macd(values) {
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);

  const line = values.map(
    (_, i) => ema12[i] - ema26[i]
  );

  const signalValues = ema(line, 9);

  const last = line.length - 1;

  const macdLine = line[last];
  const signalLine = signalValues[last];

  return {
    line: macdLine,
    signal: signalLine,
    histogram: macdLine - signalLine
  };
}

/* =========================
   CANDLE PRESSURE
========================= */

function candlePressure(candles) {
  const recent = candles.slice(-5);

  if (!recent.length) {
    return "NEUTRAL";
  }

  let total = 0;

  for (const candle of recent) {
    const range =
      candle.high - candle.low;

    if (range <= 0) continue;

    total +=
      (candle.close - candle.open) /
      range;
  }

  const value =
    total / recent.length;

  if (value >= 0.45) {
    return "STRONG BUYER";
  }

  if (value <= -0.45) {
    return "STRONG SELLER";
  }

  if (value >= 0.12) {
    return "BUYER";
  }

  if (value <= -0.12) {
    return "SELLER";
  }

  return "NEUTRAL";
}

/* =========================
   CANDLE FILTER
========================= */

function cleanCandles(candles) {
  const valid = [];

  for (const c of candles) {
    if (
      !Number.isFinite(c.time) ||
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close)
    ) {
      continue;
    }

    if (
      c.open <= 0 ||
      c.high <= 0 ||
      c.low <= 0 ||
      c.close <= 0
    ) {
      continue;
    }

    if (c.high < c.low) {
      continue;
    }

    if (c.high < c.open) {
      continue;
    }

    if (c.high < c.close) {
      continue;
    }

    if (c.low > c.open) {
      continue;
    }

    if (c.low > c.close) {
      continue;
    }

    valid.push(c);
  }

  valid.sort(
    (a, b) => a.time - b.time
  );

  return valid;
}

/* =========================
   ANALYSIS
========================= */

function analyze(inputCandles) {
  const candles =
    cleanCandles(inputCandles);

  if (candles.length < 60) {
    throw new Error(
      `Not enough valid candles (${candles.length}). Need at least 60.`
    );
  }

  const close = candles.map(
    c => c.close
  );

  const last =
    candles[candles.length - 1];

  const price = last.close;

  const ema9Values = ema(close, 9);
  const ema21Values = ema(close, 21);
  const ema50Values = ema(close, 50);

  const e9 =
    ema9Values[ema9Values.length - 1];

  const e21 =
    ema21Values[ema21Values.length - 1];

  const e50 =
    ema50Values[ema50Values.length - 1];

  const RSI = rsi(close, 14);
  const ATR = atr(candles, 14);
  const MACD = macd(close);
  const PRESSURE =
    candlePressure(candles);

  /* Support / Resistance */

  const recent =
    candles.slice(-30);

  const support = Math.min(
    ...recent.map(c => c.low)
  );

  const resistance = Math.max(
    ...recent.map(c => c.high)
  );

  /* Trend */

  const uptrend =
    e9 > e21 &&
    e21 > e50 &&
    price > e21;

  const downtrend =
    e9 < e21 &&
    e21 < e50 &&
    price < e21;

  let trend = "SIDEWAYS";

  if (uptrend) {
    trend = "UPTREND";
  } else if (downtrend) {
    trend = "DOWNTREND";
  }

  /* Momentum */

  const previousIndex =
    Math.max(0, close.length - 6);

  const previousPrice =
    close[previousIndex];

  let momentum = 0;

  if (ATR && ATR > 0) {
    momentum =
      (price - previousPrice) / ATR;
  }

  /* =========================
     SCORE
  ========================= */

  let score = 50;

  if (uptrend) {
    score += 15;
  } else if (downtrend) {
    score -= 15;
  }

  if (price > e21) {
    score += 8;
  } else if (price < e21) {
    score -= 8;
  }

  if (RSI !== null) {
    if (RSI >= 52 && RSI < 70) {
      score += 7;
    } else if (
      RSI <= 48 &&
      RSI > 30
    ) {
      score -= 7;
    }
  }

  if (MACD.histogram > 0) {
    score += 10;
  } else if (MACD.histogram < 0) {
    score -= 10;
  }

  if (
    PRESSURE === "STRONG BUYER"
  ) {
    score += 10;
  } else if (
    PRESSURE === "STRONG SELLER"
  ) {
    score -= 10;
  } else if (
    PRESSURE === "BUYER"
  ) {
    score += 4;
  } else if (
    PRESSURE === "SELLER"
  ) {
    score -= 4;
  }

  if (momentum > 0.5) {
    score += 5;
  } else if (momentum < -0.5) {
    score -= 5;
  }

  /* Support / Resistance proximity */

  if (ATR && ATR > 0) {
    if (
      price <=
      support + ATR * 0.20
    ) {
      score += 5;
    }

    if (
      price >=
      resistance - ATR * 0.20
    ) {
      score -= 5;
    }
  }

  score =
    Math.round(
      clamp(score, 0, 100)
    );

  /* =========================
     SIGNAL ENGINE
  ========================= */

  let signal = "WAIT";
  let strength = "LOW";

  /*
     Extreme RSI = WAIT
  */

  if (
    RSI !== null &&
    (RSI >= 75 || RSI <= 25)
  ) {
    signal = "WAIT";
    strength = "LOW";
  }

  /*
     STRONG BUY
  */

  else if (
    score >= 82 &&
    uptrend &&
    PRESSURE === "STRONG BUYER" &&
    MACD.histogram > 0 &&
    RSI >= 50 &&
    RSI < 72
  ) {
    signal = "STRONG BUY";
    strength = "VERY HIGH";
  }

  /*
     BUY
  */

  else if (
    score >= 72 &&
    uptrend &&
    PRESSURE !== "STRONG SELLER" &&
    MACD.histogram > 0 &&
    RSI >= 45 &&
    RSI < 70
  ) {
    signal = "BUY";
    strength = "HIGH";
  }

  /*
     STRONG SELL
  */

  else if (
    score <= 18 &&
    downtrend &&
    PRESSURE === "STRONG SELLER" &&
    MACD.histogram < 0 &&
    RSI <= 50 &&
    RSI > 28
  ) {
    signal = "STRONG SELL";
    strength = "VERY HIGH";
  }

  /*
     SELL
  */

  else if (
    score <= 28 &&
    downtrend &&
    PRESSURE !== "STRONG BUYER" &&
    MACD.histogram < 0 &&
    RSI <= 55 &&
    RSI > 30
  ) {
    signal = "SELL";
    strength = "HIGH";
  }

  /*
     Otherwise WAIT
  */

  else {
    signal = "WAIT";

    if (
      score >= 60 ||
      score <= 40
    ) {
      strength = "MEDIUM";
    } else {
      strength = "LOW";
    }
  }

  return {
    signal,
    strength,
    score,

    price: rnd(price, 6),

    trend,

    pressure: PRESSURE,

    support: rnd(support, 6),

    resistance: rnd(
      resistance,
      6
    ),

    indicators: {
      rsi: rnd(RSI, 2),

      ema9: rnd(e9, 6),
      ema21: rnd(e21, 6),
      ema50: rnd(e50, 6),

      macd: rnd(
        MACD.line,
        8
      ),

      macdSignal: rnd(
        MACD.signal,
        8
      ),

      macdHistogram: rnd(
        MACD.histogram,
        8
      ),

      atr: rnd(ATR, 8),

      momentum: rnd(
        momentum,
        2
      )
    },

    candleCount:
      candles.length,

    warning:
      "Indicator-based analysis only. No signal guarantees profit or win rate."
  };
}

/* =========================
   YAHOO SYMBOL
========================= */

function yahooSymbol(symbol) {
  let s =
    String(symbol || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");

  if (
    /^[A-Z]{3}\/[A-Z]{3}$/.test(s)
  ) {
    return (
      s.replace("/", "") +
      "=X"
    );
  }

  if (
    /^[A-Z]{6}$/.test(s)
  ) {
    return s + "=X";
  }

  return s;
}

/* =========================
   YAHOO INTERVAL
========================= */

function yahooInterval(interval) {
  const map = {
    "1min": "1m",
    "5min": "5m",
    "15min": "15m",
    "30min": "30m",
    "45min": "60m",
    "1h": "60m",
    "2h": "60m",
    "4h": "1d",
    "8h": "1d",
    "1day": "1d",
    "1week": "1wk",
    "1month": "1mo"
  };

  return (
    map[interval] ||
    "1m"
  );
}

/* =========================
   YAHOO RANGE
========================= */

function yahooRange(interval) {
  if (interval === "1min") {
    return "1d";
  }

  if (
    interval === "5min" ||
    interval === "15min"
  ) {
    return "5d";
  }

  if (
    interval === "30min" ||
    interval === "45min" ||
    interval === "1h" ||
    interval === "2h"
  ) {
    return "1mo";
  }

  if (
    interval === "4h" ||
    interval === "8h"
  ) {
    return "3mo";
  }

  return "1y";
}

/* =========================
   YAHOO CANDLES
========================= */

async function yahooCandles(
  symbol,
  interval
) {
  const yahoo =
    yahooSymbol(symbol);

  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(yahoo) +
    "?range=" +
    yahooRange(interval) +
    "&interval=" +
    yahooInterval(interval);

  const response =
    await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 MD-Shawon-Traders"
      }
    });

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Yahoo market-data HTTP ${response.status}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "Yahoo returned invalid data"
    );
  }

  if (
    data?.chart?.error
  ) {
    throw new Error(
      data.chart.error.description ||
      "Yahoo market-data error"
    );
  }

  const result =
    data?.chart?.result?.[0];

  const quote =
    result?.indicators?.quote?.[0];

  const timestamps =
    result?.timestamp || [];

  if (!quote) {
    throw new Error(
      "No market data returned for this symbol"
    );
  }

  const candles = [];

  for (
    let i = 0;
    i < timestamps.length;
    i++
  ) {
    const open =
      num(quote.open?.[i]);

    const high =
      num(quote.high?.[i]);

    const low =
      num(quote.low?.[i]);

    const close =
      num(quote.close?.[i]);

    const volume =
      num(quote.volume?.[i]) || 0;

    if (
      open !== null &&
      high !== null &&
      low !== null &&
      close !== null
    ) {
      candles.push({
        time: timestamps[i],
        open,
        high,
        low,
        close,
        volume
      });
    }
  }

  return candles;
}

/* =========================
   WORKER
========================= */

export default {
  async fetch(
    request,
    env
  ) {
    if (
      request.method ===
      "OPTIONS"
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers: CORS
        }
      );
    }

    const url =
      new URL(request.url);

    try {
      /* HOME */

      if (
        url.pathname === "/" &&
        request.method === "GET"
      ) {
        return json({
          ok: true,
          app: APP,
          version: VERSION,
          provider:
            "Yahoo Finance chart",
          note:
            "Real-market analysis only. OTC is never faked."
        });
      }

      /* DEBUG */

      if (
        url.pathname === "/debug" &&
        request.method === "GET"
      ) {
        return json({
          ok: true,
          app: APP,
          version: VERSION,
          provider:
            "Yahoo Finance chart",
          twelveDataApiKeyConfigured:
            Boolean(
              env.TWELVE_DATA_API_KEY
            )
        });
      }

      /* MARKET */

      if (
        url.pathname === "/market" &&
        request.method === "POST"
      ) {
        const body =
          await request
            .json()
            .catch(() => ({}));

        const symbol =
          body.symbol ||
          "EUR/USD";

        const interval =
          body.interval ||
          "1min";

        const mode =
          String(
            body.mode ||
            "REAL"
          ).toUpperCase();

        /* OTC */

        if (mode === "OTC") {
          return json(
            {
              ok: false,
              signal: "WAIT",
              error:
                "OTC data is not available from this provider. No fake OTC signal will be generated."
            },
            503
          );
        }

        /* REAL MARKET */

        const candles =
          await yahooCandles(
            symbol,
            interval
          );

        const analysis =
          analyze(candles);

        return json({
          ok: true,
          app: APP,
          version: VERSION,
          provider:
            "Yahoo Finance chart",
          symbol,
          interval,
          mode,
          candleCount:
            candles.length,
          analysis
        });
      }

      return json(
        {
          ok: false,
          error: "Not found"
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
            "Unknown server error"
        },
        500
      );
    }
  }
};
