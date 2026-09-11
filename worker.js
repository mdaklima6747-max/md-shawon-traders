const APP = "MD Shawon Traders";
const VERSION = "2.4.0";

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

function rnd(x, d = 6) {
  if (!Number.isFinite(x)) return null;
  const p = 10 ** d;
  return Math.round(x * p) / p;
}

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

/* =========================
   EMA
========================= */

function ema(values, period) {
  if (!values.length) return [];

  const k = 2 / (period + 1);
  const result = [values[0]];

  for (let i = 1; i < values.length; i++) {
    result.push(
      values[i] * k +
      result[i - 1] * (1 - k)
    );
  }

  return result;
}

/* =========================
   RSI
========================= */

function rsi(values, period = 14) {
  if (values.length <= period) return null;

  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];

    if (diff > 0) gain += diff;
    else loss -= diff;
  }

  let avgGain = gain / period;
  let avgLoss = loss / period;

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];

    const currentGain = Math.max(diff, 0);
    const currentLoss = Math.max(-diff, 0);

    avgGain =
      ((avgGain * (period - 1)) + currentGain) /
      period;

    avgLoss =
      ((avgLoss * (period - 1)) + currentLoss) /
      period;
  }

  if (avgLoss === 0) return 100;

  return 100 -
    100 / (1 + avgGain / avgLoss);
}

/* =========================
   ATR
========================= */

function atr(candles, period = 14) {
  if (candles.length <= period) return null;

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

  const recent = tr.slice(-period);

  if (!recent.length) return null;

  return (
    recent.reduce(
      (sum, value) => sum + value,
      0
    ) / recent.length
  );
}

/* =========================
   MACD
========================= */

function macd(values) {
  const e12 = ema(values, 12);
  const e26 = ema(values, 26);

  const line = values.map(
    (_, i) => e12[i] - e26[i]
  );

  const signalSeries = ema(line, 9);

  const lineLast = line.at(-1);
  const signalLast = signalSeries.at(-1);

  return {
    line: lineLast,
    signal: signalLast,
    histogram:
      lineLast - signalLast
  };
}

/* =========================
   Candle pressure
========================= */

function pressure(candles) {
  const recent = candles.slice(-6);

  if (!recent.length) {
    return {
      label: "NEUTRAL",
      value: 0
    };
  }

  let total = 0;

  for (const c of recent) {
    const range = c.high - c.low;

    if (range <= 0) continue;

    total +=
      (c.close - c.open) / range;
  }

  const value =
    total / recent.length;

  let label = "NEUTRAL";

  if (value >= 0.45) {
    label = "STRONG BUYER";
  } else if (value >= 0.12) {
    label = "BUYER";
  } else if (value <= -0.45) {
    label = "STRONG SELLER";
  } else if (value <= -0.12) {
    label = "SELLER";
  }

  return {
    label,
    value
  };
}

/* =========================
   Candle pattern
========================= */

function candlePattern(candles) {
  if (candles.length < 3) {
    return "NONE";
  }

  const a = candles.at(-3);
  const b = candles.at(-2);
  const c = candles.at(-1);

  const cRange = c.high - c.low;

  if (cRange <= 0) {
    return "NONE";
  }

  const body =
    Math.abs(c.close - c.open);

  const upper =
    c.high - Math.max(c.open, c.close);

  const lower =
    Math.min(c.open, c.close) - c.low;

  /* Bullish engulfing */
  if (
    b.close < b.open &&
    c.close > c.open &&
    c.open <= b.close &&
    c.close >= b.open
  ) {
    return "BULLISH ENGULFING";
  }

  /* Bearish engulfing */
  if (
    b.close > b.open &&
    c.close < c.open &&
    c.open >= b.close &&
    c.close <= b.open
  ) {
    return "BEARISH ENGULFING";
  }

  /* Hammer */
  if (
    lower >= body * 2 &&
    upper <= body &&
    c.close > c.open
  ) {
    return "HAMMER";
  }

  /* Shooting star */
  if (
    upper >= body * 2 &&
    lower <= body &&
    c.close < c.open
  ) {
    return "SHOOTING STAR";
  }

  /* Strong bullish candle */
  if (
    c.close > c.open &&
    body / cRange >= 0.65
  ) {
    return "STRONG BULLISH CANDLE";
  }

  /* Strong bearish candle */
  if (
    c.close < c.open &&
    body / cRange >= 0.65
  ) {
    return "STRONG BEARISH CANDLE";
  }

  return "NONE";
}

/* =========================
   Swing support / resistance
========================= */

function findLevels(candles, atrValue) {
  const recent = candles.slice(-80);

  if (recent.length < 10) {
    return {
      support: candles.at(-1).low,
      resistance: candles.at(-1).high
    };
  }

  const supports = [];
  const resistances = [];

  for (let i = 2; i < recent.length - 2; i++) {
    const c = recent[i];

    const left1 = recent[i - 1];
    const left2 = recent[i - 2];

    const right1 = recent[i + 1];
    const right2 = recent[i + 2];

    if (
      c.low <= left1.low &&
      c.low <= left2.low &&
      c.low <= right1.low &&
      c.low <= right2.low
    ) {
      supports.push(c.low);
    }

    if (
      c.high >= left1.high &&
      c.high >= left2.high &&
      c.high >= right1.high &&
      c.high >= right2.high
    ) {
      resistances.push(c.high);
    }
  }

  const price = candles.at(-1).close;
  const tolerance =
    Math.max(
      atrValue || 0,
      price * 0.0005
    ) * 1.5;

  function cluster(levels) {
    const groups = [];

    for (const level of levels) {
      let found = null;

      for (const group of groups) {
        if (
          Math.abs(group.level - level) <=
          tolerance
        ) {
          found = group;
          break;
        }
      }

      if (found) {
        found.sum += level;
        found.count++;
        found.level =
          found.sum / found.count;
      } else {
        groups.push({
          level,
          sum: level,
          count: 1
        });
      }
    }

    return groups;
  }

  const sGroups = cluster(supports);
  const rGroups = cluster(resistances);

  const validSupports =
    sGroups
      .filter(g => g.level < price)
      .sort(
        (a, b) => b.level - a.level
      );

  const validResistances =
    rGroups
      .filter(g => g.level > price)
      .sort(
        (a, b) => a.level - b.level
      );

  const support =
    validSupports[0]?.level ??
    Math.min(...recent.map(c => c.low));

  const resistance =
    validResistances[0]?.level ??
    Math.max(...recent.map(c => c.high));

  return {
    support,
    resistance
  };
}

/* =========================
   Trend
========================= */

function getTrend(e9, e21, e50, closes) {
  const price = closes.at(-1);

  const previous =
    closes[Math.max(0, closes.length - 6)];

  const slope =
    price - previous;

  if (
    e9 > e21 &&
    e21 > e50 &&
    slope > 0
  ) {
    return "UPTREND";
  }

  if (
    e9 < e21 &&
    e21 < e50 &&
    slope < 0
  ) {
    return "DOWNTREND";
  }

  return "SIDEWAYS";
}

/* =========================
   Main analysis engine
========================= */

function analyze(input) {

  const candles = input
    .filter(c =>
      Number.isFinite(c.time) &&
      Number.isFinite(c.open) &&
      Number.isFinite(c.high) &&
      Number.isFinite(c.low) &&
      Number.isFinite(c.close) &&

      c.open > 0 &&
      c.high > 0 &&
      c.low > 0 &&
      c.close > 0 &&

      c.high >= c.low &&
      c.high >= c.open &&
      c.high >= c.close &&
      c.low <= c.open &&
      c.low <= c.close
    )
    .sort(
      (a, b) => a.time - b.time
    );

  if (candles.length < 60) {
    throw new Error(
      `Not enough valid candles (${candles.length}); need at least 60.`
    );
  }

  const close =
    candles.map(c => c.close);

  const last =
    candles.at(-1);

  const previous =
    candles.at(-2);

  const e9Series =
    ema(close, 9);

  const e21Series =
    ema(close, 21);

  const e50Series =
    ema(close, 50);

  const e9 =
    e9Series.at(-1);

  const e21 =
    e21Series.at(-1);

  const e50 =
    e50Series.at(-1);

  const R =
    rsi(close, 14);

  const A =
    atr(candles, 14);

  const M =
    macd(close);

  const P =
    pressure(candles);

  const pattern =
    candlePattern(candles);

  const trend =
    getTrend(
      e9,
      e21,
      e50,
      close
    );

  const levels =
    findLevels(
      candles,
      A
    );

  const support =
    levels.support;

  const resistance =
    levels.resistance;

  const volatility =
    A ||
    last.close * 0.0001;

  const momentumBase =
    close[
      Math.max(
        0,
        close.length - 6
      )
    ];

  const momentum =
    (
      last.close -
      momentumBase
    ) / volatility;

  /* =========================
     BUY / SELL scoring
  ========================= */

  let buyScore = 0;
  let sellScore = 0;

  const reasonsBuy = [];
  const reasonsSell = [];

  /* Trend */

  if (trend === "UPTREND") {
    buyScore += 18;
    reasonsBuy.push("UPTREND");
  }

  if (trend === "DOWNTREND") {
    sellScore += 18;
    reasonsSell.push("DOWNTREND");
  }

  /* EMA */

  if (
    e9 > e21 &&
    e21 > e50
  ) {
    buyScore += 12;
    reasonsBuy.push("EMA ALIGNMENT BUY");
  }

  if (
    e9 < e21 &&
    e21 < e50
  ) {
    sellScore += 12;
    reasonsSell.push("EMA ALIGNMENT SELL");
  }

  /* Price vs EMA21 */

  if (last.close > e21) {
    buyScore += 7;
    reasonsBuy.push("PRICE ABOVE EMA21");
  }

  if (last.close < e21) {
    sellScore += 7;
    reasonsSell.push("PRICE BELOW EMA21");
  }

  /* RSI */

  if (
    R >= 52 &&
    R < 70
  ) {
    buyScore += 10;
    reasonsBuy.push("RSI BULLISH");
  }

  if (
    R <= 48 &&
    R > 30
  ) {
    sellScore += 10;
    reasonsSell.push("RSI BEARISH");
  }

  /* Avoid extreme RSI */

  const extremeRsi =
    R >= 75 ||
    R <= 25;

  if (extremeRsi) {
    buyScore -= 10;
    sellScore -= 10;
  }

  /* MACD */

  if (
    M.histogram > 0 &&
    M.line > M.signal
  ) {
    buyScore += 12;
    reasonsBuy.push("MACD BULLISH");
  }

  if (
    M.histogram < 0 &&
    M.line < M.signal
  ) {
    sellScore += 12;
    reasonsSell.push("MACD BEARISH");
  }

  /* Pressure */

  if (
    P.label === "STRONG BUYER"
  ) {
    buyScore += 12;
    reasonsBuy.push("STRONG BUYER PRESSURE");
  } else if (
    P.label === "BUYER"
  ) {
    buyScore += 6;
    reasonsBuy.push("BUYER PRESSURE");
  }

  if (
    P.label === "STRONG SELLER"
  ) {
    sellScore += 12;
    reasonsSell.push("STRONG SELLER PRESSURE");
  } else if (
    P.label === "SELLER"
  ) {
    sellScore += 6;
    reasonsSell.push("SELLER PRESSURE");
  }

  /* Momentum */

  if (momentum >= 0.7) {
    buyScore += 8;
    reasonsBuy.push("POSITIVE MOMENTUM");
  }

  if (momentum <= -0.7) {
    sellScore += 8;
    reasonsSell.push("NEGATIVE MOMENTUM");
  }

  /* Candle pattern */

  if (
    pattern === "BULLISH ENGULFING" ||
    pattern === "HAMMER" ||
    pattern === "STRONG BULLISH CANDLE"
  ) {
    buyScore += 8;
    reasonsBuy.push(pattern);
  }

  if (
    pattern === "BEARISH ENGULFING" ||
    pattern === "SHOOTING STAR" ||
    pattern === "STRONG BEARISH CANDLE"
  ) {
    sellScore += 8;
    reasonsSell.push(pattern);
  }

  /* =========================
     Support / Resistance
  ========================= */

  const supportDistance =
    Math.abs(
      last.close - support
    );

  const resistanceDistance =
    Math.abs(
      resistance - last.close
    );

  const nearSupport =
    supportDistance <=
    volatility * 0.45;

  const nearResistance =
    resistanceDistance <=
    volatility * 0.45;

  if (nearSupport) {
    buyScore += 8;
    reasonsBuy.push("NEAR SUPPORT");
  }

  if (nearResistance) {
    sellScore += 8;
    reasonsSell.push("NEAR RESISTANCE");
  }

  /* =========================
     Rejection candle
  ========================= */

  const range =
    last.high - last.low;

  if (range > 0) {

    const lowerWick =
      Math.min(
        last.open,
        last.close
      ) - last.low;

    const upperWick =
      last.high -
      Math.max(
        last.open,
        last.close
      );

    if (
      nearSupport &&
      lowerWick / range >= 0.45
    ) {
      buyScore += 6;
      reasonsBuy.push("SUPPORT REJECTION");
    }

    if (
      nearResistance &&
      upperWick / range >= 0.45
    ) {
      sellScore += 6;
      reasonsSell.push("RESISTANCE REJECTION");
    }
  }

  /* =========================
     Breakout
  ========================= */

  const previousResistance =
    Math.max(
      ...candles
        .slice(-21, -1)
        .map(c => c.high)
    );

  const previousSupport =
    Math.min(
      ...candles
        .slice(-21, -1)
        .map(c => c.low)
    );

  if (
    last.close >
      previousResistance &&
    last.close >
      last.open
  ) {
    buyScore += 10;
    reasonsBuy.push("BREAKOUT UP");
  }

  if (
    last.close <
      previousSupport &&
    last.close <
      last.open
  ) {
    sellScore += 10;
    reasonsSell.push("BREAKOUT DOWN");
  }

  /* =========================
     Prevent weak signals
  ========================= */

  buyScore =
    Math.round(
      clamp(
        buyScore,
        0,
        100
      )
    );

  sellScore =
    Math.round(
      clamp(
        sellScore,
        0,
        100
      )
    );

  const difference =
    Math.abs(
      buyScore -
      sellScore
    );

  let signal = "WAIT";
  let strength = "LOW";

  let directionScore =
    Math.max(
      buyScore,
      sellScore
    );

  /*
    Strong BUY
    requires many confirmations.
  */

  if (
    buyScore >= 78 &&
    buyScore > sellScore + 15 &&
    trend === "UPTREND" &&
    M.histogram > 0 &&
    P.label !== "STRONG SELLER" &&
    !extremeRsi
  ) {
    signal = "STRONG BUY";
    strength = "VERY HIGH";
  }

  /*
    Strong SELL
  */

  else if (
    sellScore >= 78 &&
    sellScore > buyScore + 15 &&
    trend === "DOWNTREND" &&
    M.histogram < 0 &&
    P.label !== "STRONG BUYER" &&
    !extremeRsi
  ) {
    signal = "STRONG SELL";
    strength = "VERY HIGH";
  }

  /*
    Normal BUY
  */

  else if (
    buyScore >= 68 &&
    buyScore > sellScore + 12 &&
    trend === "UPTREND" &&
    M.histogram > 0 &&
    !extremeRsi
  ) {
    signal = "BUY";
    strength = "HIGH";
  }

  /*
    Normal SELL
  */

  else if (
    sellScore >= 68 &&
    sellScore > buyScore + 12 &&
    trend === "DOWNTREND" &&
    M.histogram < 0 &&
    !extremeRsi
  ) {
    signal = "SELL";
    strength = "HIGH";
  }

  /*
    Everything else = WAIT
  */

  else {
    signal = "WAIT";

    if (
      directionScore >= 60 &&
      difference >= 8
    ) {
      strength = "MEDIUM";
    } else {
      strength = "LOW";
    }
  }

  return {

    signal,

    strength,

    score:
      directionScore,

    buyScore,

    sellScore,

    price:
      rnd(last.close, 6),

    trend,

    pressure:
      P.label,

    pressureValue:
      rnd(P.value, 3),

    candlePattern:
      pattern,

    support:
      rnd(support, 6),

    resistance:
      rnd(resistance, 6),

    supportDistance:
      rnd(supportDistance, 6),

    resistanceDistance:
      rnd(resistanceDistance, 6),

    momentum:
      rnd(momentum, 2),

    confirmations: {
      buy:
        reasonsBuy.slice(0, 8),

      sell:
        reasonsSell.slice(0, 8)
    },

    indicators: {

      rsi:
        rnd(R, 2),

      ema9:
        rnd(e9, 6),

      ema21:
        rnd(e21, 6),

      ema50:
        rnd(e50, 6),

      macd:
        rnd(M.line, 8),

      macdSignal:
        rnd(M.signal, 8),

      macdHistogram:
        rnd(M.histogram, 8),

      atr:
        rnd(A, 8)
    },

    validCandles:
      candles.length,

    warning:
      "Indicator-based analysis only. Signal strength is not a guaranteed win probability or profit guarantee."
  };
}

/* =========================
   Yahoo symbol
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
   Yahoo interval
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
   Yahoo range
========================= */

function yahooRange(interval) {

  if (
    interval === "1min"
  ) {
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
   Yahoo candles
========================= */

async function yahooCandles(
  symbol,
  interval
) {

  const ys =
    yahooSymbol(symbol);

  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(ys) +
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
    data =
      JSON.parse(text);
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

    if (
      open !== null &&
      high !== null &&
      low !== null &&
      close !== null &&

      open > 0 &&
      high > 0 &&
      low > 0 &&
      close > 0 &&

      high >= low &&
      high >= open &&
      high >= close &&
      low <= open &&
      low <= close
    ) {

      candles.push({

        time:
          Number(timestamps[i]),

        open,

        high,

        low,

        close,

        volume:
          num(
            quote.volume?.[i]
          ) || 0
      });
    }
  }

  return candles;
}

/* =========================
   Worker
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
            "Real-market indicator analysis. OTC is never faked."
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
            .catch(
              () => ({})
            );

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

        /* Never fake OTC */

        if (
          mode === "OTC"
        ) {

          return json(
            {

              ok: false,

              signal: "WAIT",

              strength: "LOW",

              error:
                "OTC data is not available from this provider. No fake OTC signal will be generated."
            },
            503
          );
        }

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

          strength: "LOW",

          error:
            error?.message ||
            "Unknown server error"

        },
        500
      );
    }
  }
};
