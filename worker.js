const APP_NAME = "MD Shawon Traders";
const VERSION = "5.1.0";
const PROVIDER = "Twelve Data";

const TD_URL = "https://api.twelvedata.com/time_series";

const ALLOWED_INTERVALS = new Set([
  "1min",
  "5min",
  "15min",
  "1h"
]);

const MAX_CANDLES = 180;
const MIN_CLOSED = 61;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    try {
      if (url.pathname === "/" && request.method === "GET") {
        return json({
          ok: true,
          app: APP_NAME,
          version: VERSION,
          provider: PROVIDER,
          status: "online"
        });
      }

      if (url.pathname === "/debug" && request.method === "GET") {
        return json({
          ok: true,
          app: APP_NAME,
          version: VERSION,
          provider: PROVIDER,
          twelveDataApiKeyConfigured:
            Boolean(env.TWELVE_DATA_API_KEY)
        });
      }

      if (url.pathname === "/test-auth" && request.method === "GET") {
        return await testAuth(env);
      }

      if (url.pathname === "/market" && request.method === "POST") {
        return await market(request, env);
      }

      if (url.pathname === "/chat") {
        return json({
          ok: false,
          error: "AI_CHAT_DISABLED",
          message:
            "AI chat is disabled in this zero-cost build. Market analysis works without paid AI."
        }, 503);
      }

      return json({
        ok: false,
        error: "NOT_FOUND"
      }, 404);

    } catch (error) {
      return json({
        ok: false,
        error: "WORKER_ERROR",
        message: safeError(error)
      }, 500);
    }
  }
};


/* =========================
   MARKET ENDPOINT
========================= */

async function market(request, env) {
  if (!env.TWELVE_DATA_API_KEY) {
    return json({
      ok: false,
      error: "API_KEY_NOT_CONFIGURED",
      message: "TWELVE_DATA_API_KEY is missing."
    }, 500);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      ok: false,
      error: "INVALID_JSON"
    }, 400);
  }

  const mode =
    String(body.mode || "REAL").toUpperCase();

  const symbol =
    normalizeSymbol(
      body.symbol || "EUR/USD"
    );

  const interval =
    normalizeInterval(
      body.interval || "1min"
    );

  /*
    VERIFIED OTC FEED IS NOT CONNECTED.
    NEVER GENERATE FAKE OTC DATA.
  */

  if (
    mode === "OTC" ||
    mode === "QUOTEX_OTC"
  ) {
    return json({
      ok: false,
      error: "OTC_DATA_UNAVAILABLE",
      signal: "WAIT",
      strength: 0,
      confidenceScore: 0,
      mode: "OTC",
      symbol,
      interval,
      liquidity: {
        available: false,
        status: "LOW",
        score: 0,
        condition: "DATA UNAVAILABLE",
        buySide: null,
        sellSide: null,
        nearestZone: null,
        sweep: "UNAVAILABLE"
      },
      message:
        "Verified Quotex OTC market data is not connected. No fake OTC signal will be generated."
    }, 503);
  }

  if (!ALLOWED_INTERVALS.has(interval)) {
    return json({
      ok: false,
      error: "INVALID_INTERVAL",
      allowed: [...ALLOWED_INTERVALS]
    }, 400);
  }

  if (!isValidSymbol(symbol)) {
    return json({
      ok: false,
      error: "INVALID_SYMBOL"
    }, 400);
  }

  /*
    PRIMARY TIMEFRAME
  */

  const primary =
    await fetchTD(
      env,
      symbol,
      interval,
      MAX_CANDLES
    );

  const primaryAnalysis =
    analyzeClosed(
      primary.candles
    );

  if (!primaryAnalysis.ok) {
    return json({
      ok: false,
      error: primaryAnalysis.error,
      message: primaryAnalysis.message,
      symbol,
      interval,
      mode: "REAL"
    }, 503);
  }

  /*
    HIGHER TIMEFRAME CONFIRMATION
  */

  const higherIntervals =
    getHigherTimeframes(interval);

  const mtf = {};

  for (const tf of higherIntervals) {
    try {
      const result =
        await fetchTD(
          env,
          symbol,
          tf,
          100
        );

      const a =
        analyzeClosed(
          result.candles
        );

      if (a.ok) {
        mtf[tf] = {
          trend: a.trend,
          momentum: a.momentum,
          pressure: a.pressure,
          rsi: round(a.rsi, 2),
          ema9: round(a.ema9, 6),
          ema21: round(a.ema21, 6),
          ema50: round(a.ema50, 6)
        };
      } else {
        mtf[tf] = {
          trend: "UNKNOWN",
          error: a.error
        };
      }

    } catch {
      mtf[tf] = {
        trend: "UNKNOWN",
        error: "MTF_DATA_UNAVAILABLE"
      };
    }
  }

  /*
    REAL STRUCTURAL LIQUIDITY
  */

  const liquidity =
    analyzeLiquidity(
      primaryAnalysis.closedCandles,
      primaryAnalysis.lastClose,
      primaryAnalysis.atr
    );

  /*
    DECISION
  */

  const decision =
    decide(
      primaryAnalysis,
      mtf,
      liquidity
    );

  const live =
    primary.candles[
      primary.candles.length - 1
    ];

  return json({
    ok: true,

    app: APP_NAME,
    version: VERSION,
    provider: PROVIDER,

    mode: "REAL",
    symbol,
    interval,

    signal: decision.signal,
    strength: decision.strength,
    confidenceScore: decision.score,

    buyScore: decision.buyScore,
    sellScore: decision.sellScore,
    scoreGap: decision.gap,

    reason: decision.reasons,
    reasons: decision.reasons,

    livePrice:
      live
        ? live.close
        : null,

    trend:
      primaryAnalysis.trend,

    momentum:
      primaryAnalysis.momentum,

    pressure:
      primaryAnalysis.pressure,

    rsi:
      round(
        primaryAnalysis.rsi,
        2
      ),

    ema9:
      round(
        primaryAnalysis.ema9,
        6
      ),

    ema21:
      round(
        primaryAnalysis.ema21,
        6
      ),

    ema50:
      round(
        primaryAnalysis.ema50,
        6
      ),

    macd: {
      value:
        round(
          primaryAnalysis.macd,
          6
        ),

      signal:
        round(
          primaryAnalysis.macdSignal,
          6
        ),

      histogram:
        round(
          primaryAnalysis.macdHistogram,
          6
        )
    },

    atr:
      round(
        primaryAnalysis.atr,
        6
      ),

    support:
      round(
        primaryAnalysis.support,
        6
      ),

    resistance:
      round(
        primaryAnalysis.resistance,
        6
      ),

    pattern:
      primaryAnalysis.pattern,

    previousCandle:
      primaryAnalysis.previousCandle,

    previous2Candle:
      primaryAnalysis.previous2Candle,

    /*
      LIQUIDITY OUTPUT
    */

    liquidity,

    mtf,

    closedCandles:
      primaryAnalysis.closedCount,

    candles:
      primary.candles.slice(-120),

    generatedAt:
      new Date().toISOString()
  });
}


/* =========================
   TWELVE DATA
========================= */

async function fetchTD(
  env,
  symbol,
  interval,
  outputsize
) {
  const key =
    env.TWELVE_DATA_API_KEY;

  const url =
    TD_URL +
    "?symbol=" +
    encodeURIComponent(symbol) +
    "&interval=" +
    encodeURIComponent(interval) +
    "&outputsize=" +
    Math.min(outputsize, 5000) +
    "&format=JSON" +
    "&order=asc";

  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          "Authorization":
            "apikey " + key,

          "Accept":
            "application/json"
        }
      }
    );

  let data;

  try {
    data =
      await response.json();
  } catch {
    throw new Error(
      "Twelve Data returned an invalid response."
    );
  }

  if (!response.ok) {
    throw new Error(
      "Twelve Data HTTP " +
      response.status +
      ": " +
      (
        data?.message ||
        "request failed"
      )
    );
  }

  if (data?.status === "error") {
    throw new Error(
      data.message ||
      "Twelve Data rejected the request."
    );
  }

  if (
    !Array.isArray(
      data?.values
    )
  ) {
    throw new Error(
      data?.message ||
      "No candle data returned."
    );
  }

  const candles =
    data.values
      .map(normalizeCandle)
      .filter(Boolean)
      .sort(
        (a, b) =>
          new Date(a.time) -
          new Date(b.time)
      );

  if (
    candles.length <
    MIN_CLOSED
  ) {
    throw new Error(
      "Not enough candle data. Received " +
      candles.length +
      ", minimum required is " +
      MIN_CLOSED +
      "."
    );
  }

  return {
    meta:
      data.meta || {},

    candles
  };
}


/* =========================
   AUTH TEST
========================= */

async function testAuth(env) {
  if (!env.TWELVE_DATA_API_KEY) {
    return json({
      ok: false,
      authentication: "MISSING",
      provider: PROVIDER,
      httpStatus: null,
      message:
        "TWELVE_DATA_API_KEY is not configured."
    }, 500);
  }

  const url =
    TD_URL +
    "?symbol=AAPL" +
    "&interval=1min" +
    "&outputsize=1" +
    "&format=JSON";

  const response =
    await fetch(
      url,
      {
        headers: {
          "Authorization":
            "apikey " +
            env.TWELVE_DATA_API_KEY,

          "Accept":
            "application/json"
        }
      }
    );

  let data = {};

  try {
    data =
      await response.json();
  } catch {}

  if (
    response.ok &&
    data?.status !== "error" &&
    Array.isArray(
      data?.values
    )
  ) {
    return json({
      ok: true,
      authentication: "VALID",
      provider: PROVIDER,
      httpStatus:
        response.status,
      message:
        "Twelve Data API authentication works."
    });
  }

  return json({
    ok: false,
    authentication: "INVALID",
    provider: PROVIDER,
    httpStatus:
      response.status,
    message:
      data?.message ||
      "Twelve Data rejected the API key."
  }, 401);
}


/* =========================
   ANALYSIS ENGINE
========================= */

function analyzeClosed(allCandles) {
  if (
    !Array.isArray(
      allCandles
    )
  ) {
    return {
      ok: false,
      error: "INVALID_CANDLES"
    };
  }

  if (
    allCandles.length <
    MIN_CLOSED
  ) {
    return {
      ok: false,
      error:
        "NOT_ENOUGH_CANDLES",

      message:
        "At least " +
        MIN_CLOSED +
        " candles are required."
    };
  }

  /*
    Exclude the latest possibly-forming candle.
  */

  const closed =
    allCandles.length > 1
      ? allCandles.slice(0, -1)
      : allCandles;

  if (
    closed.length <
    MIN_CLOSED
  ) {
    return {
      ok: false,
      error:
        "NOT_ENOUGH_CLOSED_CANDLES"
    };
  }

  const closes =
    closed.map(
      x => x.close
    );

  const highs =
    closed.map(
      x => x.high
    );

  const lows =
    closed.map(
      x => x.low
    );

  const ema9 =
    ema(
      closes,
      9
    );

  const ema21 =
    ema(
      closes,
      21
    );

  const ema50 =
    ema(
      closes,
      50
    );

  const rsiValue =
    rsi(
      closes,
      14
    );

  const macdData =
    macd(
      closes
    );

  const atrValue =
    atr(
      closed,
      14
    );

  const last =
    closed[
      closed.length - 1
    ];

  const prev =
    closed[
      closed.length - 2
    ];

  const prev2 =
    closed[
      closed.length - 3
    ];

  const trend =
    last.close > ema21 &&
    ema9 > ema21 &&
    ema21 > ema50

      ? "UPTREND"

      : last.close < ema21 &&
        ema9 < ema21 &&
        ema21 < ema50

        ? "DOWNTREND"

        : "SIDEWAYS";

  const momentum =
    closes.length >= 10
      ? last.close >
        closes[
          closes.length - 10
        ]

        ? "BULLISH"

        : last.close <
          closes[
            closes.length - 10
          ]

          ? "BEARISH"

          : "NEUTRAL"

      : "NEUTRAL";

  const pressure =
    candlePressure(
      closed.slice(-8)
    );

  const pattern =
    detectPattern(
      prev,
      last
    );

  /*
    Structural support / resistance
  */

  const support =
    Math.min(
      ...lows.slice(-30)
    );

  const resistance =
    Math.max(
      ...highs.slice(-30)
    );

  const previousCandle =
    candleSide(
      prev
    );

  const previous2Candle =
    candleSide(
      prev2
    );

  return {
    ok: true,

    closedCount:
      closed.length,

    /*
      Needed by liquidity engine.
    */

    closedCandles:
      closed,

    lastClose:
      last.close,

    trend,
    momentum,
    pressure,

    rsi:
      rsiValue,

    ema9,
    ema21,
    ema50,

    macd:
      macdData.macd,

    macdSignal:
      macdData.signal,

    macdHistogram:
      macdData.histogram,

    atr:
      atrValue,

    support,
    resistance,

    pattern,

    previousCandle,
    previous2Candle
  };
}


/* =========================
   DECISION ENGINE
========================= */

function decide(
  a,
  mtf,
  liquidity
) {
  let buy = 0;
  let sell = 0;

  const reasonsBuy = [];
  const reasonsSell = [];

  /*
    TREND
  */

  if (
    a.trend ===
    "UPTREND"
  ) {
    buy += 20;

    reasonsBuy.push(
      "Primary trend is bullish."
    );
  }

  if (
    a.trend ===
    "DOWNTREND"
  ) {
    sell += 20;

    reasonsSell.push(
      "Primary trend is bearish."
    );
  }

  /*
    EMA
  */

  if (
    a.ema9 >
      a.ema21 &&
    a.ema21 >
      a.ema50
  ) {
    buy += 14;

    reasonsBuy.push(
      "EMA 9 > EMA 21 > EMA 50."
    );
  }

  if (
    a.ema9 <
      a.ema21 &&
    a.ema21 <
      a.ema50
  ) {
    sell += 14;

    reasonsSell.push(
      "EMA 9 < EMA 21 < EMA 50."
    );
  }

  /*
    RSI
  */

  if (
    a.rsi >= 52 &&
    a.rsi <= 68
  ) {
    buy += 10;

    reasonsBuy.push(
      "RSI supports bullish momentum."
    );
  }

  if (
    a.rsi <= 48 &&
    a.rsi >= 32
  ) {
    sell += 10;

    reasonsSell.push(
      "RSI supports bearish momentum."
    );
  }

  /*
    MACD
  */

  if (
    a.macd >
      a.macdSignal &&
    a.macdHistogram > 0
  ) {
    buy += 12;

    reasonsBuy.push(
      "MACD bullish."
    );
  }

  if (
    a.macd <
      a.macdSignal &&
    a.macdHistogram < 0
  ) {
    sell += 12;

    reasonsSell.push(
      "MACD bearish."
    );
  }

  /*
    MOMENTUM
  */

  if (
    a.momentum ===
    "BULLISH"
  ) {
    buy += 8;

    reasonsBuy.push(
      "Price momentum is bullish."
    );
  }

  if (
    a.momentum ===
    "BEARISH"
  ) {
    sell += 8;

    reasonsSell.push(
      "Price momentum is bearish."
    );
  }

  /*
    PREVIOUS CANDLE
  */

  if (
    a.previousCandle ===
    "BUYER"
  ) {
    buy += 12;

    reasonsBuy.push(
      "Previous closed candle shows buyer pressure."
    );
  }

  if (
    a.previousCandle ===
    "SELLER"
  ) {
    sell += 12;

    reasonsSell.push(
      "Previous closed candle shows seller pressure."
    );
  }

  /*
    CANDLE PRESSURE
  */

  if (
    a.pressure === "BUYER" ||
    a.pressure === "STRONG BUYER"
  ) {
    buy += 8;

    reasonsBuy.push(
      "Recent candles show buyer pressure."
    );
  }

  if (
    a.pressure === "SELLER" ||
    a.pressure === "STRONG SELLER"
  ) {
    sell += 8;

    reasonsSell.push(
      "Recent candles show seller pressure."
    );
  }

  /*
    PATTERN
  */

  if (
    a.pattern ===
      "BULLISH_REJECTION" ||
    a.pattern ===
      "BULLISH_ENGULFING"
  ) {
    buy += 8;

    reasonsBuy.push(
      "Bullish candle pattern detected."
    );
  }

  if (
    a.pattern ===
      "BEARISH_REJECTION" ||
    a.pattern ===
      "BEARISH_ENGULFING"
  ) {
    sell += 8;

    reasonsSell.push(
      "Bearish candle pattern detected."
    );
  }

  /*
    MTF
  */

  const higher =
    Object.values(mtf)
      .filter(
        x =>
          x &&
          x.trend
      );

  const bullishHigher =
    higher.filter(
      x =>
        x.trend ===
        "UPTREND"
    ).length;

  const bearishHigher =
    higher.filter(
      x =>
        x.trend ===
        "DOWNTREND"
    ).length;

  if (
    bullishHigher > 0
  ) {
    buy += 8;

    reasonsBuy.push(
      bullishHigher +
      " higher timeframe(s) confirm bullish trend."
    );
  }

  if (
    bearishHigher > 0
  ) {
    sell += 8;

    reasonsSell.push(
      bearishHigher +
      " higher timeframe(s) confirm bearish trend."
    );
  }

  /*
    LIQUIDITY CONFIRMATION
  */

  if (
    liquidity &&
    liquidity.available
  ) {
    /*
      Sell-side sweep can indicate
      rejection after taking lows.
    */

    if (
      liquidity.sweep ===
      "SELL-SIDE SWEEP"
    ) {
      buy += 8;

      reasonsBuy.push(
        "Sell-side liquidity sweep detected."
      );
    }

    /*
      Buy-side sweep can indicate
      rejection after taking highs.
    */

    if (
      liquidity.sweep ===
      "BUY-SIDE SWEEP"
    ) {
      sell += 8;

      reasonsSell.push(
        "Buy-side liquidity sweep detected."
      );
    }

    if (
      liquidity.status ===
      "HIGH"
    ) {
      if (
        a.trend ===
        "UPTREND"
      ) {
        buy += 4;

        reasonsBuy.push(
          "Strong structural liquidity supports the bullish setup."
        );
      }

      if (
        a.trend ===
        "DOWNTREND"
      ) {
        sell += 4;

        reasonsSell.push(
          "Strong structural liquidity supports the bearish setup."
        );
      }
    }

    if (
      liquidity.status ===
      "LOW"
    ) {
      reasonsBuy.push(
        "Liquidity structure is weak."
      );

      reasonsSell.push(
        "Liquidity structure is weak."
      );
    }
  }

  /*
    STRONG PRESSURE PENALTY
  */

  if (
    a.pressure ===
    "STRONG SELLER"
  ) {
    buy -= 15;
  }

  if (
    a.pressure ===
    "STRONG BUYER"
  ) {
    sell -= 15;
  }

  buy =
    Math.max(
      0,
      Math.round(buy)
    );

  sell =
    Math.max(
      0,
      Math.round(sell)
    );

  const gap =
    Math.abs(
      buy - sell
    );

  let signal =
    "WAIT";

  let strength = 0;

  let reasons = [];

  /*
    STRICT BUY
  */

  const buyGate =
    a.trend ===
      "UPTREND" &&

    buy >= 76 &&

    gap >= 28 &&

    (
      a.previousCandle ===
        "BUYER" ||
      a.previousCandle ===
        "STRONG BUYER"
    ) &&

    a.pressure !==
      "STRONG SELLER" &&

    bullishHigher >= 1;

  /*
    STRICT SELL
  */

  const sellGate =
    a.trend ===
      "DOWNTREND" &&

    sell >= 76 &&

    gap >= 28 &&

    (
      a.previousCandle ===
        "SELLER" ||
      a.previousCandle ===
        "STRONG SELLER"
    ) &&

    a.pressure !==
      "STRONG BUYER" &&

    bearishHigher >= 1;

  /*
    STRONG BUY
  */

  const strongBuy =
    buy >= 92 &&

    gap >= 42 &&

    a.pressure ===
      "STRONG BUYER" &&

    bullishHigher ===
      higher.length &&

    higher.length > 0;

  /*
    STRONG SELL
  */

  const strongSell =
    sell >= 92 &&

    gap >= 42 &&

    a.pressure ===
      "STRONG SELLER" &&

    bearishHigher ===
      higher.length &&

    higher.length > 0;

  /*
    Final decision
  */

  if (
    strongBuy
  ) {
    signal =
      "STRONG BUY";

    strength = 95;

    reasons = [
      ...reasonsBuy.slice(0, 7),

      "All available higher timeframes confirm bullish direction."
    ];

  } else if (
    strongSell
  ) {
    signal =
      "STRONG SELL";

    strength = 95;

    reasons = [
      ...reasonsSell.slice(0, 7),

      "All available higher timeframes confirm bearish direction."
    ];

  } else if (
    buyGate
  ) {
    signal =
      "BUY";

    strength =
      Math.min(
        92,
        buy
      );

    reasons =
      reasonsBuy.slice(
        0,
        8
      );

  } else if (
    sellGate
  ) {
    signal =
      "SELL";

    strength =
      Math.min(
        92,
        sell
      );

    reasons =
      reasonsSell.slice(
        0,
        8
      );

  } else {
    signal =
      "WAIT";

    strength =
      Math.min(
        74,
        Math.max(
          buy,
          sell
        )
      );

    reasons = [
      "Confirmation is not strong enough.",
      "No high-confidence trade signal was produced."
    ];

    if (
      buy > sell
    ) {
      reasons.push(
        "Bullish evidence exists but strict BUY conditions are incomplete."
      );
    }

    if (
      sell > buy
    ) {
      reasons.push(
        "Bearish evidence exists but strict SELL conditions are incomplete."
      );
    }

    if (
      liquidity &&
      liquidity.status ===
      "LOW"
    ) {
      reasons.push(
        "Liquidity structure is weak, so WAIT is preferred."
      );
    }
  }

  return {
    signal,

    strength,

    score:
      Math.max(
        buy,
        sell
      ),

    buyScore:
      buy,

    sellScore:
      sell,

    gap,

    reasons
  };
}


/* =========================
   LIQUIDITY ENGINE
========================= */

function analyzeLiquidity(
  candles,
  price,
  atrValue
) {
  if (
    !Array.isArray(candles) ||
    candles.length < 20 ||
    !Number.isFinite(price)
  ) {
    return {
      available: false,

      status: "LOW",

      score: 0,

      condition:
        "DATA UNAVAILABLE",

      buySide: null,

      sellSide: null,

      nearestZone: null,

      sweep:
        "UNAVAILABLE"
    };
  }

  const recent =
    candles.slice(-60);

  const safeAtr =
    Number.isFinite(
      atrValue
    ) &&
    atrValue > 0

      ? atrValue

      : Math.max(
          price * 0.001,
          0.000001
        );

  /*
    Cluster tolerance is based
    on market volatility.
  */

  const tolerance =
    Math.max(
      safeAtr * 0.18,
      price * 0.00005
    );

  const highs = [];
  const lows = [];

  /*
    Detect swing highs/lows.
  */

  for (
    let i = 2;
    i < recent.length - 2;
    i++
  ) {
    const c =
      recent[i];

    const isSwingHigh =
      c.high >=
        recent[i - 1].high &&

      c.high >=
        recent[i - 2].high &&

      c.high >=
        recent[i + 1].high &&

      c.high >=
        recent[i + 2].high;

    const isSwingLow =
      c.low <=
        recent[i - 1].low &&

      c.low <=
        recent[i - 2].low &&

      c.low <=
        recent[i + 1].low &&

      c.low <=
        recent[i + 2].low;

    if (
      isSwingHigh
    ) {
      highs.push({
        price:
          c.high,

        index:
          i
      });
    }

    if (
      isSwingLow
    ) {
      lows.push({
        price:
          c.low,

        index:
          i
      });
    }
  }

  /*
    Cluster repeated levels.
  */

  const buyClusters =
    clusterLiquidity(
      highs,
      tolerance
    )
      .filter(
        x =>
          x.price > price
      )
      .sort(
        (a, b) =>
          Math.abs(
            a.price - price
          ) -
          Math.abs(
            b.price - price
          )
      );

  const sellClusters =
    clusterLiquidity(
      lows,
      tolerance
    )
      .filter(
        x =>
          x.price < price
      )
      .sort(
        (a, b) =>
          Math.abs(
            a.price - price
          ) -
          Math.abs(
            b.price - price
          )
      );

  const buySide =
    buyClusters.length
      ? buyClusters[0]
      : null;

  const sellSide =
    sellClusters.length
      ? sellClusters[0]
      : null;

  /*
    Liquidity sweep detection.
  */

  const last =
    recent[
      recent.length - 1
    ];

  let sweep =
    "NONE";

  /*
    Price moves above buy-side liquidity
    then closes back below it.
  */

  if (
    buySide &&
    last.high >
      buySide.price &&
    last.close <
      buySide.price
  ) {
    sweep =
      "BUY-SIDE SWEEP";
  }

  /*
    Price moves below sell-side liquidity
    then closes back above it.
  */

  if (
    sellSide &&
    last.low <
      sellSide.price &&
    last.close >
      sellSide.price
  ) {
    sweep =
      "SELL-SIDE SWEEP";
  }

  /*
    Strength.
  */

  const buyStrength =
    buySide
      ? liquidityStrength(
          buySide
        )
      : 0;

  const sellStrength =
    sellSide
      ? liquidityStrength(
          sellSide
        )
      : 0;

  const clusterStrength =
    Math.max(
      buyStrength,
      sellStrength
    );

  let score =
    Math.round(
      Math.min(
        100,
        clusterStrength
      )
    );

  if (
    sweep !== "NONE"
  ) {
    score =
      Math.min(
        100,
        score + 12
      );
  }

  let status =
    "LOW";

  if (
    score >= 75
  ) {
    status =
      "HIGH";

  } else if (
    score >= 45
  ) {
    status =
      "MEDIUM";
  }

  /*
    Nearest liquidity zone.
  */

  let nearestZone =
    null;

  if (
    buySide &&
    sellSide
  ) {
    const buyDistance =
      Math.abs(
        buySide.price -
        price
      );

    const sellDistance =
      Math.abs(
        sellSide.price -
        price
      );

    nearestZone =
      buyDistance <=
      sellDistance

        ? {
            side:
              "BUY-SIDE",

            price:
              round(
                buySide.price,
                6
              ),

            strength:
              buySide.strength
          }

        : {
            side:
              "SELL-SIDE",

            price:
              round(
                sellSide.price,
                6
              ),

            strength:
              sellSide.strength
          };

  } else if (
    buySide
  ) {
    nearestZone = {
      side:
        "BUY-SIDE",

      price:
        round(
          buySide.price,
          6
        ),

      strength:
        buySide.strength
    };

  } else if (
    sellSide
  ) {
    nearestZone = {
      side:
        "SELL-SIDE",

      price:
        round(
          sellSide.price,
          6
        ),

      strength:
        sellSide.strength
    };
  }

  let condition =
    "WEAK STRUCTURAL LIQUIDITY";

  if (
    status === "HIGH"
  ) {
    condition =
      "STRONG STRUCTURAL LIQUIDITY";

  } else if (
    status === "MEDIUM"
  ) {
    condition =
      "MODERATE STRUCTURAL LIQUIDITY";
  }

  return {
    available:
      Boolean(
        buySide ||
        sellSide
      ),

    status,

    score,

    condition,

    buySide:
      buySide
        ? {
            price:
              round(
                buySide.price,
                6
              ),

            strength:
              buySide.strength,

            touches:
              buySide.touches
          }
        : null,

    sellSide:
      sellSide
        ? {
            price:
              round(
                sellSide.price,
                6
              ),

            strength:
              sellSide.strength,

            touches:
              sellSide.touches
          }
        : null,

    nearestZone,

    sweep
  };
}


function clusterLiquidity(
  points,
  tolerance
) {
  const clusters = [];

  for (
    const point of points
  ) {
    let found =
      null;

    for (
      const cluster of clusters
    ) {
      if (
        Math.abs(
          cluster.price -
          point.price
        ) <=
        tolerance
      ) {
        found =
          cluster;

        break;
      }
    }

    if (
      found
    ) {
      found.prices.push(
        point.price
      );

      found.touches +=
        1;

      found.price =
        found.prices.reduce(
          (a, b) =>
            a + b,
          0
        ) /
        found.prices.length;

    } else {
      clusters.push({
        price:
          point.price,

        prices: [
          point.price
        ],

        touches:
          1,

        strength:
          0
      });
    }
  }

  for (
    const cluster of clusters
  ) {
    cluster.strength =
      liquidityStrength(
        cluster
      );
  }

  return clusters;
}


function liquidityStrength(
  cluster
) {
  if (!cluster) {
    return 0;
  }

  const touches =
    Number(
      cluster.touches || 1
    );

  /*
    Repeated structural
    levels are stronger.
  */

  return Math.min(
    100,

    35 +
      (touches - 1) *
        20
  );
}


/* =========================
   INDICATORS
========================= */

function ema(
  values,
  period
) {
  if (!values.length) {
    return 0;
  }

  const k =
    2 /
    (period + 1);

  let value =
    values
      .slice(
        0,
        Math.min(
          period,
          values.length
        )
      )
      .reduce(
        (a, b) =>
          a + b,
        0
      ) /
    Math.min(
      period,
      values.length
    );

  for (
    let i =
      Math.min(
        period,
        values.length
      );

    i <
    values.length;

    i++
  ) {
    value =
      values[i] * k +
      value * (1 - k);
  }

  return value;
}


function rsi(
  values,
  period = 14
) {
  if (
    values.length <=
    period
  ) {
    return 50;
  }

  let gain = 0;
  let loss = 0;

  for (
    let i = 1;
    i <= period;
    i++
  ) {
    const diff =
      values[i] -
      values[i - 1];

    if (
      diff >= 0
    ) {
      gain += diff;
    } else {
      loss -= diff;
    }
  }

  let avgGain =
    gain / period;

  let avgLoss =
    loss / period;

  for (
    let i =
      period + 1;

    i <
    values.length;

    i++
  ) {
    const diff =
      values[i] -
      values[i - 1];

    const g =
      diff > 0
        ? diff
        : 0;

    const l =
      diff < 0
        ? -diff
        : 0;

    avgGain =
      (
        avgGain *
          (period - 1) +
        g
      ) /
      period;

    avgLoss =
      (
        avgLoss *
          (period - 1) +
        l
      ) /
      period;
  }

  if (
    avgLoss === 0
  ) {
    return 100;
  }

  const rs =
    avgGain /
    avgLoss;

  return (
    100 -
    100 /
      (1 + rs)
  );
}


function macd(values) {
  const fast =
    emaSeries(
      values,
      12
    );

  const slow =
    emaSeries(
      values,
      26
    );

  const line = [];

  const start = 26;

  for (
    let i = start;
    i < values.length;
    i++
  ) {
    line.push(
      fast[i] -
      slow[i]
    );
  }

  if (
    line.length < 10
  ) {
    return {
      macd: 0,
      signal: 0,
      histogram: 0
    };
  }

  const signalSeries =
    emaSeries(
      line,
      9
    );

  const m =
    line[
      line.length - 1
    ];

  const s =
    signalSeries[
      signalSeries.length - 1
    ];

  return {
    macd: m,
    signal: s,
    histogram:
      m - s
  };
}


function emaSeries(
  values,
  period
) {
  if (!values.length) {
    return [];
  }

  const k =
    2 /
    (period + 1);

  const result =
    new Array(
      values.length
    );

  const initialCount =
    Math.min(
      period,
      values.length
    );

  const initial =
    values
      .slice(
        0,
        initialCount
      )
      .reduce(
        (a, b) =>
          a + b,
        0
      ) /
    initialCount;

  for (
    let i = 0;
    i < initialCount;
    i++
  ) {
    result[i] =
      initial;
  }

  let previous =
    initial;

  for (
    let i =
      initialCount;

    i <
    values.length;

    i++
  ) {
    previous =
      values[i] * k +
      previous *
        (1 - k);

    result[i] =
      previous;
  }

  return result;
}


function atr(
  candles,
  period = 14
) {
  if (
    candles.length <
    period + 1
  ) {
    return 0;
  }

  const trs = [];

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {
    const c =
      candles[i];

    const p =
      candles[i - 1];

    const tr =
      Math.max(
        c.high - c.low,

        Math.abs(
          c.high -
          p.close
        ),

        Math.abs(
          c.low -
          p.close
        )
      );

    trs.push(tr);
  }

  const recent =
    trs.slice(
      -period
    );

  return (
    recent.reduce(
      (a, b) =>
        a + b,
      0
    ) /
    recent.length
  );
}


/* =========================
   CANDLE ANALYSIS
========================= */

function candleSide(c) {
  if (!c) {
    return "UNKNOWN";
  }

  const range =
    Math.max(
      c.high -
        c.low,

      0.00000001
    );

  const body =
    Math.abs(
      c.close -
      c.open
    );

  const bodyRatio =
    body / range;

  if (
    c.close >
    c.open
  ) {
    return bodyRatio >=
      0.55
      ? "STRONG BUYER"
      : "BUYER";
  }

  if (
    c.close <
    c.open
  ) {
    return bodyRatio >=
      0.55
      ? "STRONG SELLER"
      : "SELLER";
  }

  return "NEUTRAL";
}


function candlePressure(
  candles
) {
  if (
    !candles.length
  ) {
    return "NEUTRAL";
  }

  let buyer = 0;
  let seller = 0;

  for (
    const c of candles
  ) {
    const range =
      Math.max(
        c.high -
          c.low,

        0.00000001
      );

    const body =
      Math.abs(
        c.close -
        c.open
      );

    const ratio =
      body / range;

    if (
      c.close >
      c.open
    ) {
      buyer +=
        ratio >= 0.55
          ? 2
          : 1;
    }

    if (
      c.close <
      c.open
    ) {
      seller +=
        ratio >= 0.55
          ? 2
          : 1;
    }
  }

  const diff =
    buyer -
    seller;

  if (
    diff >= 5
  ) {
    return "STRONG BUYER";
  }

  if (
    diff >= 2
  ) {
    return "BUYER";
  }

  if (
    diff <= -5
  ) {
    return "STRONG SELLER";
  }

  if (
    diff <= -2
  ) {
    return "SELLER";
  }

  return "NEUTRAL";
}


function detectPattern(
  prev,
  last
) {
  if (
    !prev ||
    !last
  ) {
    return "NONE";
  }

  const prevBull =
    prev.close >
    prev.open;

  const prevBear =
    prev.close <
    prev.open;

  const lastBull =
    last.close >
    last.open;

  const lastBear =
    last.close <
    last.open;

  /*
    Bullish engulfing
  */

  if (
    prevBear &&
    lastBull &&
    last.open <=
      prev.close &&
    last.close >=
      prev.open
  ) {
    return "BULLISH_ENGULFING";
  }

  /*
    Bearish engulfing
  */

  if (
    prevBull &&
    lastBear &&
    last.open >=
      prev.close &&
    last.close <=
      prev.open
  ) {
    return "BEARISH_ENGULFING";
  }

  /*
    Wick analysis
  */

  const lowerWick =
    Math.min(
      last.open,
      last.close
    ) -
    last.low;

  const upperWick =
    last.high -
    Math.max(
      last.open,
      last.close
    );

  const body =
    Math.abs(
      last.close -
      last.open
    );

  /*
    Bullish rejection
  */

  if (
    lowerWick >
      body * 2 &&
    lowerWick >
      upperWick
  ) {
    return "BULLISH_REJECTION";
  }

  /*
    Bearish rejection
  */

  if (
    upperWick >
      body * 2 &&
    upperWick >
      lowerWick
  ) {
    return "BEARISH_REJECTION";
  }

  return "NONE";
}


/* =========================
   SYMBOL / TIMEFRAME
========================= */

function normalizeSymbol(
  symbol
) {
  return String(symbol)
    .trim()
    .toUpperCase()
    .replace(
      /\s+/g,
      ""
    );
}


function normalizeInterval(
  interval
) {
  const value =
    String(interval)
      .trim()
      .toLowerCase();

  const aliases = {
    "1m": "1min",
    "5m": "5min",
    "15m": "15min",
    "60m": "1h",
    "1hr": "1h",
    "1hour": "1h"
  };

  return (
    aliases[value] ||
    value
  );
}


function getHigherTimeframes(
  interval
) {
  if (
    interval ===
    "1min"
  ) {
    return [
      "5min",
      "15min",
      "1h"
    ];
  }

  if (
    interval ===
    "5min"
  ) {
    return [
      "15min",
      "1h"
    ];
  }

  if (
    interval ===
    "15min"
  ) {
    return [
      "1h"
    ];
  }

  return [];
}


function isValidSymbol(
  symbol
) {
  return /^[A-Z0-9._:/-]{2,40}$/
    .test(symbol);
}


/* =========================
   CANDLE NORMALIZATION
========================= */

function normalizeCandle(
  row
) {
  if (!row) {
    return null;
  }

  const open =
    Number(row.open);

  const high =
    Number(row.high);

  const low =
    Number(row.low);

  const close =
    Number(row.close);

  if (
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    return null;
  }

  return {
    time:
      row.datetime,

    open,
    high,
    low,
    close,

    volume:
      row.volume != null
        ? Number(
            row.volume
          )
        : null
  };
}


/* =========================
   HELPERS
========================= */

function round(
  value,
  digits = 6
) {
  if (
    !Number.isFinite(value)
  ) {
    return null;
  }

  const p =
    Math.pow(
      10,
      digits
    );

  return (
    Math.round(
      value * p
    ) / p
  );
}


function safeError(
  error
) {
  if (!error) {
    return "Unknown error.";
  }

  return String(
    error.message ||
    error
  ).slice(
    0,
    500
  );
}


function json(
  data,
  status = 200
) {
  return cors(
    new Response(
      JSON.stringify(
        data
      ),
      {
        status,

        headers: {
          "Content-Type":
            "application/json; charset=utf-8",

          "Cache-Control":
            "no-store"
        }
      }
    )
  );
}


function cors(
  response
) {
  const headers =
    new Headers(
      response.headers
    );

  headers.set(
    "Access-Control-Allow-Origin",
    "*"
  );

  headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );

  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  headers.set(
    "Access-Control-Max-Age",
    "86400"
  );

  return new Response(
    response.body,
    {
      status:
        response.status,

      statusText:
        response.statusText,

      headers
    }
  );
}
