const ALLOWED_ORIGINS = "*";
// MD Shawon Traders
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

function corsHeaders(origin = "") {
  return {
    "Access-Control-Allow-Origin":
      ALLOWED_ORIGINS === "*" ? "*" : origin || ALLOWED_ORIGINS,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin)
    }
  });
}

function error(message, status = 400, origin = "") {
  return json(
    {
      ok: false,
      error: message
    },
    status,
    origin
  );
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
    .map((x) => ({
      time: x.datetime || x.timestamp || null,
      open: Number(x.open),
      high: Number(x.high),
      low: Number(x.low),
      close: Number(x.close),
      volume:
        x.volume === undefined || x.volume === null
          ? null
          : Number(x.volume)
    }))
    .filter(
      (x) =>
        x.time &&
        Number.isFinite(x.open) &&
        Number.isFinite(x.high) &&
        Number.isFinite(x.low) &&
        Number.isFinite(x.close)
    )
    .reverse();
}

async function getMarketData(request, env, origin) {
  if (!env.TWELVE_DATA_API_KEY) {
    return error("TWELVE_DATA_API_KEY is not configured.", 500, origin);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON body.", 400, origin);
  }

  const symbol = normalizeSymbol(body.symbol);
  const interval = String(body.interval || "1min");
  const outputsize = Math.min(
    Math.max(Number(body.outputsize) || 300, 10),
    5000
  );

  if (!symbol) {
    return error("A market symbol is required.", 400, origin);
  }

  if (!INTERVALS.has(interval)) {
    return error(
      "Unsupported interval. Use 1min, 5min, 15min, 30min, 45min, 1h, 2h, 4h, 8h, 1day, 1week or 1month.",
      400,
      origin
    );
  }

  const url = new URL("https://api.twelvedata.com/time_series");

  url.searchParams.set("apikey", env.TWELVE_DATA_API_KEY);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", String(outputsize));
  url.searchParams.set("format", "JSON");

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    const data = await response.json();

    if (!response.ok || data.status === "error") {
      return error(
        data.message || "Market data provider returned an error.",
        response.status || 502,
        origin
      );
    }

    const candles = normalizeCandles(data.values);

    if (!candles.length) {
      return error(
        "No market candles are currently available for this symbol.",
        404,
        origin
      );
    }

    return json(
      {
        ok: true,
        source: "Twelve Data",
        symbol,
        interval,
        timezone: data.meta?.timezone || null,
        currency: data.meta?.currency || null,
        exchange: data.meta?.exchange || null,
        candles
      },
      200,
      origin
    );
  } catch (err) {
    return error(
      "Unable to reach the market data provider.",
      502,
      origin
    );
  }
}

function cleanMessages(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter((m) => m && typeof m === "object")
    .map((m) => ({
      role:
        m.role === "assistant" || m.role === "system"
          ? m.role
          : "user",
      content: String(m.content || "").slice(0, 8000)
    }))
    .filter((m) => m.content.trim())
    .slice(-20);
}

async function aiChat(request, env, origin) {
  if (!env.OPENAI_API_KEY) {
    return error("OPENAI_API_KEY is not configured.", 500, origin);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return error("Invalid JSON body.", 400, origin);
  }

  const messages = cleanMessages(body.messages);

  if (!messages.length) {
    return error("At least one chat message is required.", 400, origin);
  }

  const systemInstruction = `
You are MD Shawon Traders AI.

You are a helpful trading assistant.
Speak naturally and clearly.
The user may communicate in Bengali or English.
If the user speaks Bengali, answer in Bengali.

Important safety rules:
- Never guarantee profit.
- Never claim a trade is certain to win.
- Never call a signal a guaranteed prediction.
- Treat BUY, SELL and WAIT as analysis signals only.
- Explain that real markets can move unexpectedly.
- If market data is missing or stale, say so instead of inventing data.
- Do not invent prices, candles, indicators or market conditions.

You can explain technical-analysis concepts such as:
support, resistance, RSI, EMA, MACD, ATR,
momentum, trend, candle patterns, breakout,
rejection, buyer/seller pressure and multi-timeframe confirmation.
`;

  const input = [
    {
      role: "system",
      content: systemInstruction
    },
    ...messages
  ];

  try {
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-5.5",
          input,
          max_output_tokens: 1000
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return error(
        data?.error?.message ||
          "OpenAI returned an error.",
        response.status || 502,
        origin
      );
    }

    let text = "";

    if (typeof data.output_text === "string") {
      text = data.output_text;
    }

    if (!text && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (!Array.isArray(item.content)) continue;

        for (const part of item.content) {
          if (
            part &&
            part.type === "output_text" &&
            typeof part.text === "string"
          ) {
            text += part.text;
          }
        }
      }
    }

    if (!text.trim()) {
      text = "I couldn't generate a response right now.";
    }

    return json(
      {
        ok: true,
        reply: text.trim()
      },
      200,
      origin
    );
  } catch (err) {
    return error(
      "Unable to connect to the AI service.",
      502,
      origin
    );
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin)
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json(
        {
          ok: true,
          app: "MD Shawon Traders",
          worker: "online",
          version: "1.0.0",
          endpoints: {
            health: "GET /",
            market: "POST /market",
            chat: "POST /chat"
          }
        },
        200,
        origin
      );
    }

    if (request.method === "POST" && url.pathname === "/market") {
      return getMarketData(request, env, origin);
    }

    if (request.method === "POST" && url.pathname === "/chat") {
      return aiChat(request, env, origin);
    }

    return error("Endpoint not found.", 404, origin);
  }
};
