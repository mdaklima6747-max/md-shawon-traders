// MD Shawon Traders — Worker 4.0.0
// 1-minute-first real-market signal engine.
// No fake Quotex OTC data. No AI API required.
// IMPORTANT: This is an indicator engine, not a profit/win-rate guarantee.

const APP = "MD Shawon Traders";
const VERSION = "4.0.0";
const DEFAULT_SYMBOL = "EUR/USD";
const DEFAULT_INTERVAL = "1min";

const ALLOWED = new Set([
  "1min","5min","15min","30min","45min",
  "1h","2h","4h","8h","1day","1week","1month"
]);

const MTF = {
  "1min":["5min","15min"],
  "5min":["15min","1h"],
  "15min":["1h","4h"]
};

const CORS = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type, Authorization",
  "Content-Type":"application/json; charset=utf-8"
};

const json = (x,s=200) =>
  new Response(JSON.stringify(x),{status:s,headers:CORS});

const n = x => {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
};

const clamp = (x,a,b) => Math.max(a,Math.min(b,x));

const rnd = (x,d=6) =>
  x==null ? null : Math.round(x*10**d)/10**d;

function normalizeSymbol(s){
  return String(s||DEFAULT_SYMBOL)
    .trim()
    .toUpperCase()
    .replace(/\s+/g,"");
}

function emaSeries(v,p){
  if(!Array.isArray(v)||v.length<p)return [];

  const out=Array(v.length).fill(null);

  let e=0;
  for(let i=0;i<p;i++) e+=v[i];

  e/=p;
  out[p-1]=e;

  const k=2/(p+1);

  for(let i=p;i<v.length;i++){
    e=v[i]*k+e*(1-k);
    out[i]=e;
  }

  return out;
}

const last = a => a?.length ? a[a.length-1] : null;

const ema = (v,p) => last(emaSeries(v,p));

function rsi(v,p=14){
  if(!v||v.length<=p)return null;

  let g=0,l=0;

  for(let i=1;i<=p;i++){
    const d=v[i]-v[i-1];

    if(d>0) g+=d;
    else l-=d;
  }

  let ag=g/p;
  let al=l/p;

  for(let i=p+1;i<v.length;i++){
    const d=v[i]-v[i-1];
    const gg=Math.max(d,0);
    const ll=Math.max(-d,0);

    ag=(ag*(p-1)+gg)/p;
    al=(al*(p-1)+ll)/p;
  }

  return al===0 ? 100 : 100-100/(1+ag/al);
}

function atr(c,p=14){
  if(!c||c.length<=p)return null;

  const tr=[];

  for(let i=1;i<c.length;i++){
    const x=c[i];
    const q=c[i-1];

    tr.push(
      Math.max(
        x.high-x.low,
        Math.abs(x.high-q.close),
        Math.abs(x.low-q.close)
      )
    );
  }

  let a=tr.slice(0,p)
    .reduce((x,y)=>x+y,0)/p;

  for(let i=p;i<tr.length;i++){
    a=(a*(p-1)+tr[i])/p;
  }

  return a;
}

function macd(v){
  const e12=emaSeries(v,12);
  const e26=emaSeries(v,26);
  const line=[];

  for(let i=0;i<v.length;i++){
    if(e12[i]!=null&&e26[i]!=null){
      line.push(e12[i]-e26[i]);
    }
  }

  const sig=ema(line,9);
  const ln=last(line);

  return {
    line:ln,
    signal:sig,
    histogram:
      ln!=null&&sig!=null
        ? ln-sig
        : null
  };
}

function candleInfo(c){
  const range=Math.max(c.high-c.low,1e-12);
  const body=Math.abs(c.close-c.open);

  const upper=c.high-Math.max(c.open,c.close);
  const lower=Math.min(c.open,c.close)-c.low;

  const ratio=body/range;

  let direction =
    c.close>c.open
      ? "BUYER"
      : c.close<c.open
        ? "SELLER"
        : "NEUTRAL";

  let pattern="NORMAL";

  if(c.close>c.open&&ratio>=.65)
    pattern="STRONG BULLISH";

  else if(c.close<c.open&&ratio>=.65)
    pattern="STRONG BEARISH";

  else if(
    lower>=body*2 &&
    lower>=upper*1.3
  )
    pattern="HAMMER / BULLISH REJECTION";

  else if(
    upper>=body*2 &&
    upper>=lower*1.3
  )
    pattern="SHOOTING STAR / BEARISH REJECTION";

  return {
    direction,
    pattern,
    range,
    body,
    upper,
    lower,
    bodyRatio:ratio
  };
}

function pressure(c){
  const a=c.slice(-6);

  if(!a.length)
    return {
      label:"NEUTRAL",
      score:0
    };

  let s=0;

  for(const x of a){
    s+=(x.close-x.open)/
      Math.max(x.high-x.low,1e-12);
  }

  s/=a.length;

  return {
    label:
      s>=.35
        ? "STRONG BUYER"
        : s>=.10
          ? "BUYER"
          : s<=-.35
            ? "STRONG SELLER"
            : s<=-.10
              ? "SELLER"
              : "NEUTRAL",
    score:s
  };
}

// Swing-based support/resistance.
// A single extreme wick is not treated as a strong level.
function supportResistance(c){
  const r=c.slice(-80);
  const A=atr(r,14)||0;

  if(r.length<10)
    return {
      support:null,
      resistance:null
    };

  const tol=Math.max(
    A*.35,
    Math.abs(r.at(-1).close)*0.00015
  );

  const lows=[];
  const highs=[];

  for(let i=2;i<r.length-2;i++){
    const x=r[i];

    if(
      x.low<=r[i-1].low &&
      x.low<=r[i-2].low &&
      x.low<=r[i+1].low &&
      x.low<=r[i+2].low
    ){
      lows.push(x.low);
    }

    if(
      x.high>=r[i-1].high &&
      x.high>=r[i-2].high &&
      x.high>=r[i+1].high &&
      x.high>=r[i+2].high
    ){
      highs.push(x.high);
    }
  }

  const cluster=(vals,prefer)=>{
    if(!vals.length)return null;

    const groups=[];

    for(const v of vals){
      let g=groups.find(
        z=>Math.abs(z.center-v)<=tol
      );

      if(!g){
        groups.push({
          center:v,
          count:1
        });
      }else{
        g.center=
          (g.center*g.count+v)/
          (g.count+1);

        g.count++;
      }
    }

    groups.sort((a,b)=>b.count-a.count);

    const eligible=
      groups.filter(
        g =>
          prefer==="support"
            ? g.center<=r.at(-1).close
            : g.center>=r.at(-1).close
      );

    return (eligible[0]||groups[0]).center;
  };

  return {
    support:cluster(lows,"support"),
    resistance:cluster(highs,"resistance")
  };
}

function trend(v){
  const e9=ema(v,9);
  const e21=ema(v,21);
  const e50=ema(v,50);

  if(
    e9==null||
    e21==null||
    e50==null
  )
    return "UNKNOWN";

  if(e9>e21&&e21>e50)
    return "UPTREND";

  if(e9<e21&&e21<e50)
    return "DOWNTREND";

  return "SIDEWAYS";
}

function analyzeClosed(closed){
  const v=closed.map(x=>x.close);

  const p=closed.at(-1);
  const p2=closed.at(-2);

  const e9=ema(v,9);
  const e21=ema(v,21);
  const e50=ema(v,50);

  const R=rsi(v);
  const A=atr(closed);
  const M=macd(v);

  const T=trend(v);
  const P=pressure(closed);
  const sr=supportResistance(closed);

  const ci=candleInfo(p);
  const c2=candleInfo(p2);

  let buy=0;
  let sell=0;

  const br=[];
  const srn=[];

  const add=(side,pts,text)=>{
    if(side==="buy"){
      buy+=pts;
      br.push(text);
    }else{
      sell+=pts;
      srn.push(text);
    }
  };

  if(T==="UPTREND")
    add("buy",18,"EMA 9 > EMA 21 > EMA 50");

  if(T==="DOWNTREND")
    add("sell",18,"EMA 9 < EMA 21 < EMA 50");

  if(p.close>e21)
    add("buy",8,"Closed price above EMA21");

  if(p.close<e21)
    add("sell",8,"Closed price below EMA21");

  if(R!=null){
    if(R>=52&&R<70)
      add("buy",8,"RSI bullish zone");

    else if(R>30&&R<=48)
      add("sell",8,"RSI bearish zone");

    else if(R>=70)
      add("sell",3,"RSI overbought caution");

    else if(R<=30)
      add("buy",3,"RSI oversold caution");
  }

  if(M.histogram>0)
    add("buy",12,"MACD histogram bullish");

  if(M.histogram<0)
    add("sell",12,"MACD histogram bearish");

  if(P.label==="STRONG BUYER")
    add("buy",12,"Strong buyer pressure");

  else if(P.label==="BUYER")
    add("buy",6,"Buyer pressure");

  if(P.label==="STRONG SELLER")
    add("sell",12,"Strong seller pressure");

  else if(P.label==="SELLER")
    add("sell",6,"Seller pressure");

  if(ci.direction==="BUYER")
    add("buy",7,"Previous closed candle was buyer");

  if(ci.direction==="SELLER")
    add("sell",7,"Previous closed candle was seller");

  if(ci.pattern.includes("BULLISH"))
    add("buy",5,ci.pattern);

  if(ci.pattern.includes("BEARISH"))
    add("sell",5,ci.pattern);

  if(
    ci.direction==="BUYER"&&
    c2.direction==="BUYER"
  )
    add("buy",5,"Two consecutive buyer candles");

  if(
    ci.direction==="SELLER"&&
    c2.direction==="SELLER"
  )
    add("sell",5,"Two consecutive seller candles");

  const mom=
    A
      ? (p.close-closed.at(-6).close)/A
      : 0;

  if(mom>.5)
    add("buy",8,"Positive momentum");

  if(mom<-.5)
    add("sell",8,"Negative momentum");

  const range=
    (sr.resistance??0)-
    (sr.support??0);

  if(range>0){
    const ns=
      (p.close-sr.support)/range<.12;

    const nr=
      (sr.resistance-p.close)/range<.12;

    if(ns&&ci.direction==="BUYER")
      add(
        "buy",
        7,
        "Buyer rejection near support"
      );

    if(nr&&ci.direction==="SELLER")
      add(
        "sell",
        7,
        "Seller rejection near resistance"
      );
  }

  return {
    trend:T,
    pressure:P,
    support:sr.support,
    resistance:sr.resistance,

    indicators:{
      rsi:R,
      ema9:e9,
      ema21:e21,
      ema50:e50,
      macd:M.line,
      macdSignal:M.signal,
      macdHistogram:M.histogram,
      atr:A,
      momentum:mom
    },

    previousCandle:{
      ...p,
      direction:ci.direction,
      pattern:ci.pattern,
      bodyRatio:ci.bodyRatio
    },

    previous2Candle:{
      ...p2,
      direction:c2.direction,
      pattern:c2.pattern
    },

    buyScore:buy,
    sellScore:sell,
    confirmationGap:Math.abs(buy-sell),

    buyReasons:br,
    sellReasons:srn
  };
}

function decide(a,mtf){
  let buy=a.buyScore;
  let sell=a.sellScore;

  const br=[...a.buyReasons];
  const sr=[...a.sellReasons];

  const baseTrend=a.trend;

  const mtfBuy=
    mtf.filter(
      x=>x.trend==="UPTREND"
    ).length;

  const mtfSell=
    mtf.filter(
      x=>x.trend==="DOWNTREND"
    ).length;

  if(mtfBuy>mtfSell){
    buy+=10;
    br.push(
      "Higher-timeframe confirmation bullish"
    );
  }

  if(mtfSell>mtfBuy){
    sell+=10;
    sr.push(
      "Higher-timeframe confirmation bearish"
    );
  }

  const gap=Math.abs(buy-sell);
  const dom=buy>=sell?"BUY":"SELL";

  let signal="WAIT";
  let strength="LOW";

  const candleBuyer=
    a.previousCandle.direction==="BUYER";

  const candleSeller=
    a.previousCandle.direction==="SELLER";

  // Strict 1M gate.
  if(
    baseTrend==="UPTREND"&&
    buy>=76&&
    gap>=28&&
    candleBuyer&&
    a.pressure.label!=="STRONG SELLER"&&
    mtfBuy>=1
  ){
    signal=
      buy>=92&&
      gap>=42&&
      a.pressure.label==="STRONG BUYER"&&
      mtfBuy===mtf.length
        ? "STRONG BUY"
        : "BUY";

    strength=
      signal==="STRONG BUY"
        ? "VERY HIGH"
        : "HIGH";

  }else if(
    baseTrend==="DOWNTREND"&&
    sell>=76&&
    gap>=28&&
    candleSeller&&
    a.pressure.label!=="STRONG BUYER"&&
    mtfSell>=1
  ){

    signal=
      sell>=92&&
      gap>=42&&
      a.pressure.label==="STRONG SELLER"&&
      mtfSell===mtf.length
        ? "STRONG SELL"
        : "SELL";

    strength=
      signal==="STRONG SELL"
        ? "VERY HIGH"
        : "HIGH";

  }else if(
    Math.max(buy,sell)>=58&&
    gap>=14
  ){
    strength="MEDIUM";
  }

  return {
    signal,
    strength,
    buyScore:buy,
    sellScore:sell,
    confirmationGap:gap,
    dominant:dom,
    buyReasons:br,
    sellReasons:sr,
    mtfBuy,
    mtfSell
  };
}

function intervalForSymbol(i){
  return i;
}

async function fetchTD(
  env,
  symbol,
  interval,
  outputsize
){
  const u=
    "https://api.twelvedata.com/time_series"+
    "?apikey="+
    encodeURIComponent(
      env.TWELVE_DATA_API_KEY
    )+
    "&symbol="+
    encodeURIComponent(symbol)+
    "&interval="+
    encodeURIComponent(
      intervalForSymbol(interval)
    )+
    "&outputsize="+
    outputsize+
    "&format=JSON";

  const r=await fetch(u);

  let d={};

  try{
    d=await r.json();
  }catch{}

  if(!r.ok||d.status==="error"){
    const e=new Error(
      d.message||
      `Twelve Data HTTP ${r.status}`
    );

    e.code=d.code||r.status;

    throw e;
  }

  return normalize(d.values);
}

function normalize(values){
  if(!Array.isArray(values))
    return [];

  return values
    .map(x=>({
      datetime:x.datetime,
      open:n(x.open),
      high:n(x.high),
      low:n(x.low),
      close:n(x.close),
      volume:n(x.volume)||0
    }))
    .filter(
      x=>
        x.open!=null&&
        x.high!=null&&
        x.low!=null&&
        x.close!=null
    )
    .sort(
      (a,b)=>
        new Date(a.datetime)-
        new Date(b.datetime)
    );
}

async function market(request,env){

  if(!env.TWELVE_DATA_API_KEY){
    return json({
      ok:false,
      error:
        "TWELVE_DATA_API_KEY is missing in Cloudflare."
    },500);
  }

  let b={};

  try{
    b=await request.json();
  }catch{
    return json({
      ok:false,
      error:"Invalid JSON body."
    },400);
  }

  const symbol=
    normalizeSymbol(b.symbol);

  const interval=
    String(
      b.interval||
      DEFAULT_INTERVAL
    ).trim();

  const mode=
    String(
      b.mode||
      "REAL"
    ).toUpperCase();

  const outputsize=
    clamp(
      Number(b.outputsize)||120,
      70,
      500
    );

  if(mode==="OTC"){
    return json({
      ok:false,
      signal:"WAIT",
      mode:"OTC",
      error:
        "Verified Quotex OTC feed is not connected. No fake OTC signal will be generated."
    },503);
  }

  if(!ALLOWED.has(interval)){
    return json({
      ok:false,
      error:
        `Unsupported interval: ${interval}`
    },400);
  }

  try{

    const raw=
      await fetchTD(
        env,
        symbol,
        interval,
        outputsize
      );

    if(raw.length<62){
      return json({
        ok:false,
        error:
          `Only ${raw.length} valid candles returned; at least 62 are required.`
      },502);
    }

    // Never use newest provider candle
    // as the closed candle.
    const live=raw.at(-1);
    const closed=raw.slice(0,-1);

    const base=
      analyzeClosed(closed);

    // MTF confirmation.
    const mtfIntervals=
      MTF[interval]||[];

    const mtf=[];

    for(const tf of mtfIntervals){

      const d=
        await fetchTD(
          env,
          symbol,
          tf,
          100
        );

      if(d.length<62){
        throw new Error(
          `Not enough ${tf} candles for MTF confirmation.`
        );
      }

      mtf.push({
        interval:tf,
        ...analyzeClosed(
          d.slice(0,-1)
        )
      });
    }

    const decision=
      decide(base,mtf);

    return json({

      ok:true,

      app:APP,

      version:VERSION,

      source:"Twelve Data",

      mode:"REAL",

      symbol,

      interval,

      livePrice:
        rnd(live.close,8),

      liveCandle:{
        datetime:live.datetime,
        open:rnd(live.open,8),
        high:rnd(live.high,8),
        low:rnd(live.low,8),
        close:rnd(live.close,8)
      },

      analyzedCandle:
        "PREVIOUS CLOSED CANDLE",

      targetCandle:
        "NEXT CANDLE",

      analyzedPrice:
        rnd(
          base.previousCandle.close,
          8
        ),

      signal:
        decision.signal,

      strength:
        decision.strength,

      score:
        Math.round(
          clamp(
            50+
            (decision.buyScore-
             decision.sellScore)*.55,
            0,
            100
          )
        ),

      buyScore:
        decision.buyScore,

      sellScore:
        decision.sellScore,

      confirmationGap:
        decision.confirmationGap,

      dominant:
        decision.dominant,

      trend:
        base.trend,

      pressure:
        base.pressure.label,

      pressureScore:
        rnd(
          base.pressure.score,
          3
        ),

      support:
        rnd(base.support,8),

      resistance:
        rnd(base.resistance,8),

      previousCandle:{
        datetime:
          base.previousCandle.datetime,

        open:
          rnd(
            base.previousCandle.open,
            8
          ),

        high:
          rnd(
            base.previousCandle.high,
            8
          ),

        low:
          rnd(
            base.previousCandle.low,
            8
          ),

        close:
          rnd(
            base.previousCandle.close,
            8
          ),

        direction:
          base.previousCandle.direction,

        pattern:
          base.previousCandle.pattern,

        bodyRatio:
          rnd(
            base.previousCandle.bodyRatio,
            3
          )
      },

      indicators:
        Object.fromEntries(
          Object.entries(
            base.indicators
          ).map(
            ([k,v])=>[
              k,
              rnd(
                v,
                k==="rsi"||
                k==="momentum"
                  ? 2
                  : 10
              )
            ]
          )
        ),

      mtf:
        mtf.map(x=>({
          interval:x.interval,
          trend:x.trend,
          pressure:x.pressure.label,
          rsi:rnd(
            x.indicators.rsi,
            2
          )
        })),

      confirmations:{
        buy:
          decision.buyReasons,

        sell:
          decision.sellReasons
      },

      candleCount:
        raw.length,

      closedCandleCount:
        closed.length,

      warning:
        "Indicator strength is not win probability. No signal guarantees profit."
    });

  }catch(e){

    return json({
      ok:false,
      signal:"WAIT",
      error:
        "Market analysis failed.",
      details:
        e?.message||
        "Unknown error",
      code:
        e?.code||
        null
    },502);
  }
}

export default {

  async fetch(request,env){

    if(request.method==="OPTIONS"){
      return new Response(
        null,
        {
          status:204,
          headers:CORS
        }
      );
    }

    const u=
      new URL(request.url);

    if(
      request.method==="GET"&&
      u.pathname==="/"
    ){
      return json({

        ok:true,

        app:APP,

        version:VERSION,

        worker:"online",

        provider:"Twelve Data",

        primaryTimeframe:"1min",

        features:[
          "closed-candle analysis",
          "EMA",
          "RSI",
          "MACD",
          "ATR",
          "momentum",
          "buyer/seller pressure",
          "swing support/resistance",
          "MTF confirmation",
          "strict WAIT gate"
        ],

        endpoints:{
          health:"GET /",
          debug:"GET /debug",
          market:"POST /market"
        },

        note:
          "Real market only. Quotex OTC is blocked until a verified OTC feed is connected."
      });
    }

    if(
      request.method==="GET"&&
      u.pathname==="/debug"
    ){
      return json({

        ok:true,

        app:APP,

        version:VERSION,

        provider:"Twelve Data",

        twelveDataApiKeyConfigured:
          Boolean(
            env.TWELVE_DATA_API_KEY
          )
      });
    }

    if(
      request.method==="POST"&&
      u.pathname==="/market"
    ){
      return market(
        request,
        env
      );
    }

    if(
      request.method==="POST"&&
      u.pathname==="/chat"
    ){
      return json({
        ok:false,
        available:false,
        message:
          "AI chat is not enabled because no paid AI API is configured. Local rule-based market analysis remains available."
      },503);
    }

    return json({
      ok:false,
      error:"Endpoint not found."
    },404);
  }
};
