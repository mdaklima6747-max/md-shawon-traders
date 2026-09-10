const APP = "MD Shawon Traders";
const VERSION = "2.2.0";

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
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function rnd(x, d = 6) {
  const p = 10 ** d;
  return Math.round(x * p) / p;
}

function ema(v, p) {
  if (!v.length) return [];

  const k = 2 / (p + 1);
  const out = [v[0]];

  for (let i = 1; i < v.length; i++) {
    out.push(v[i] * k + out[i - 1] * (1 - k));
  }

  return out;
}

function rsi(v, p = 14) {
  if (v.length <= p) return null;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= p; i++) {
    const d = v[i] - v[i - 1];

    if (d > 0) gain += d;
    else loss -= d;
  }

  let avgGain = gain / p;
  let avgLoss = loss / p;

  for (let i = p + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);

    avgGain = (avgGain * (p - 1) + g) / p;
    avgLoss = (avgLoss * (p - 1) + l) / p;
  }

  if (avgLoss === 0) return 100;

  return 100 - 100 / (1 + avgGain / avgLoss);
}

function atr(c, p = 14) {
  if (c.length < p + 1) return null;

  const tr = [];

  for (let i = 1; i < c.length; i++) {
    tr.push(
      Math.max(
        c[i].high - c[i].low,
        Math.abs(c[i].high - c[i - 1].close),
        Math.abs(c[i].low - c[i - 1].close)
      )
    );
  }

  return tr.slice(-p).reduce((a, b) => a + b, 0) / p;
}

function macd(v) {
  const e12 = ema(v, 12);
  const e26 = ema(v, 26);

  const line = v.map((_, i) => e12[i] - e26[i]);
  const signal = ema(line, 9);

  const m = line[line.length - 1];
  const s = signal[signal.length - 1];

  return {
    line: m,
    signal: s,
    hist: m - s
  };
}

function pressure(c) {
  let total = 0;

  for (const x of c.slice(-5)) {
    total += (x.close - x.open) / (x.high - x.low || 1);
  }

  const value = total / Math.min(5, c.length);

  if (value > 0.45) return "STRONG BUYER";
  if (value < -0.45) return "STRONG SELLER";
  if (value > 0.12) return "BUYER";
  if (value < -0.12) return "SELLER";

  return "NEUTRAL";
}

function analyze(c) {
  c.sort((a, b) => a.time - b.time);

  if (c.length < 60) {
    throw new Error(
      `Not enough candle data (${c.length}); need at least 60.`
    );
  }

  const close = c.map(x => x.close);
  const last = c[c.length - 1];

  const e9 = ema(close, 9).at(-1);
  const e21 = ema(close, 21).at(-1);
  const e50 = ema(close, 50).at(-1);

  const R = rsi(close);
  const A = atr(c);
  const M = macd(close);
  const P = pressure(c);

  const highs = c.slice(-30).map(x => x.high);
  const lows = c.slice(-30).map(x => x.low);

  const support = Math.min(...lows);
  const resistance = Math.max(...highs);

  const up = e9 > e21 && e21 > e50;
  const down = e9 < e21 && e21 < e50;

  const momentum =
    (last.close - close[Math.max(0, close.length - 6)]) /
    (A || last.close * 0.0001);

  let score = 50;

  if (up) score += 12;
  else if (down) score -= 12;

  if (last.close > e21) score += 8;
  else score -= 8;

  if (R >= 50 && R < 70) score += 7;
  else if (R <= 50 && R > 30) score -= 7;

  if (M.hist > 0) score += 10;
  else score -= 10;

  if (P === "STRONG BUYER") score += 8;
  else if (P === "STRONG SELLER") score -= 8;
  else if (P === "BUYER") score += 4;
  else if (P === "SELLER") score -= 4;

  if (momentum > 0.5) score += 5;
  else if (momentum < -0.5) score -= 5;

  if (last.close <= support + A * 0.15) score += 6;

  if (last.close >= resistance - A * 0.15) score -= 6;

  score = Math.round(clamp(score, 0, 100));

  let signal = "WAIT";
  let strength = "LOW";

  if (R > 75 || R < 25) {
    signal = "WAIT";
  } else if (
    score >= 82 &&
    up &&
    P === "STRONG BUYER" &&
    M.hist > 0
  ) {
    signal = "STRONG BUY";
    strength = "VERY HIGH";
  } else if (
    score >= 70 &&
    up &&
    P !== "STRONG SELLER"
  ) {
    signal = "BUY";
    strength = "HIGH";
  } else if (
    score <= 18 &&
    down &&
    P === "STRONG SELLER" &&
    M.hist < 0
  ) {
    signal = "STRONG SELL";
    strength = "VERY HIGH";
  } else if (
    score <= 30 &&
    down &&
    P !== "STRONG BUYER"
  ) {
    signal = "SELL";
    strength = "HIGH";
  } else if (score >= 60 || score <= 40) {
    strength = "MEDIUM";
  }

  return {
    signal,
    strength,
    score,
    price: rnd(last.close),

    trend: up
      ? "UPTREND"
      : down
      ? "DOWNTREND"
      : "SIDEWAYS",

    pressure: P,

    support: rnd(support),
    resistance: rnd(resistance),

    indicators: {
      rsi: rnd(R, 2),
      ema9: rnd(e9),
      ema21: rnd(e21),
      ema50: rnd(e50),

      macd: rnd(M.line, 8),
      macdSignal: rnd(M.signal, 8),
      macdHistogram: rnd(M.hist, 8),

      atr: rnd(A, 8),
      momentum: rnd(momentum, 2)
    },

    warning:
      "Indicator-based analysis only. No signal guarantees profit or win rate."
  };
}

function yahooSymbol(symbol) {
  let s = String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(s)) {
    return s.replace("/", "") + "=X";
  }

  if (/^[A-Z]{6}$/.test(s)) {
    return s + "=X";
  }

  return s;
}

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

  return map[interval] || "1m";
}

function yahooRange(interval) {
  if (interval === "1min") return "1d";

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

async function yahooCandles(symbol, interval) {
  const ys = yahooSymbol(symbol);

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(ys)}` +
    `?range=${yahooRange(interval)}` +
    `&interval=${yahooInterval(interval)}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 MD-Shawon-Traders"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Yahoo market-data HTTP ${response.status}`
    );
  }

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Yahoo returned invalid data");
  }

  if (data?.chart?.error) {
    throw new Error(
      data.chart.error.description ||
      "Yahoo market-data error"
    );
  }

  const result = data?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp || [];

  if (!quote) {
    throw new Error(
      "No market data returned for this symbol"
    );
  }

  const candles = [];

  for (let i = 0; i < timestamps.length; i++) {
    const open = num(quote.open?.[i]);
    const high = num(quote.high?.[i]);
    const low = num(quote.low?.[i]);
    const close = num(quote.close?.[i]);

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
        volume: num(quote.volume?.[i]) || 0
      });
    }
  }

  return candles;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS
      });
    }

    const url = new URL(request.url);

    try {
      if (
        url.pathname === "/" &&
        request.method === "GET"
      ) {
        return json({
          ok: true,
          app: APP,
          version: VERSION,
          dataProvider: "Yahoo Finance chart",
          note: "Real-market data only. OTC is not faked."
        });
      }

      if (
        url.pathname === "/debug" &&
        request.method === "GET"
      ) {
        return json({
          ok: true,
          app: APP,
          version: VERSION,
          dataProvider: "Yahoo Finance chart",
          twelveDataApiKeyConfigured:
            Boolean(env.TWELVE_DATA_API_KEY)
        });
      }

      if (
        url.pathname === "/market" &&
        request.method === "POST"
      ) {
        const body = await request.json().catch(() => ({}));

        const symbol = body.symbol || "EUR/USD";
        const interval = body.interval || "1min";
        const mode = String(
          body.mode || "REAL"
        ).toUpperCase();

        if (mode === "OTC") {
          return json(
            {
              ok: false,
              signal: "WAIT",
              error:
                "OTC data unavailable from this provider. No fake OTC signal will be generated."
            },
            503
          );
        }

        const candles = await yahooCandles(
          symbol,
          interval
        );

        const analysis = analyze(candles);

        return json({
          ok: true,
          app: APP,
          version: VERSION,
          provider: "Yahoo Finance chart",
          symbol,
          interval,
          mode,
          candleCount: candles.length,
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
