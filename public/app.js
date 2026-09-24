const $ = s => document.querySelector(s);

/* =========================================================
   BESTIE BOT — STRATEGY B
   DEMO / PAPER TESTING ONLY
   EMA 20 + EMA 50 + RSI 14
   Trend → Pullback → Momentum Confirmation
   ========================================================= */

const prices = [];

let tests = 0;
let wins = 0;
let losses = 0;

let pendingTest = null;
let lastSignal = "WAIT";

let startingCapital = 20;
let currentCapital = 20;

let actualDemoPL = 0;
let activeContractId = null;

let cooldownTicks = 0;

/* -------------------------
   INDICATORS
------------------------- */

const ema = (values, period) => {
  if (values.length < period) return null;

  const k = 2 / (period + 1);

  /*
    Seed from the first available price.
    We keep the same basic EMA method as the original bot.
  */
  let e = values[0];

  for (let i = 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }

  return e;
};

const rsi = (values, period = 14) => {
  if (values.length < period + 1) return null;

  let gains = 0;
  let lossesValue = 0;

  for (
    let i = values.length - period;
    i < values.length;
    i++
  ) {
    const difference = values[i] - values[i - 1];

    if (difference > 0) {
      gains += difference;
    } else {
      lossesValue -= difference;
    }
  }

  const averageGain = gains / period;
  const averageLoss = lossesValue / period;

  if (averageLoss === 0) {
    return averageGain === 0 ? 50 : 100;
  }

  const rs = averageGain / averageLoss;

  return 100 - (100 / (1 + rs));
};

/* -------------------------
   STRATEGY ENGINE
------------------------- */

const strategyState = () => {
  const e20 = ema(prices, 20);
  const e50 = ema(prices, 50);
  const r = rsi(prices, 14);

  if (
    e20 == null ||
    e50 == null ||
    r == null ||
    prices.length < 50
  ) {
    return {
      trend: "WAITING",
      pullback: "WAITING",
      confirmation: "WAITING",
      signal: "WAIT",
      ema20: e20,
      ema50: e50,
      rsi: r
    };
  }

  const price = prices[prices.length - 1];
  const previousPrice =
    prices.length >= 2
      ? prices[prices.length - 2]
      : price;

  /*
    TREND FILTER

    EMA20 > EMA50 = bullish environment
    EMA20 < EMA50 = bearish environment
  */

  let trend = "FLAT";

  if (e20 > e50) {
    trend = "BULLISH";
  } else if (e20 < e50) {
    trend = "BEARISH";
  }

  /*
    PULLBACK ZONE

    Instead of demanding an exact touch of EMA20,
    allow a small adaptive zone around it.

    The zone is based on the current separation
    between EMA20 and EMA50.

    A minimum percentage prevents the zone from
    becoming impossibly tiny.
  */

  const trendGap = Math.abs(e20 - e50);

  const minimumZone =
    Math.max(Math.abs(price) * 0.00005, 0.00001);

  const pullbackZone =
    Math.max(trendGap * 0.35, minimumZone);

  let pullback = "NO";

  if (
    trend === "BULLISH" &&
    Math.abs(price - e20) <= pullbackZone
  ) {
    pullback = "BULLISH SETUP";
  }

  if (
    trend === "BEARISH" &&
    Math.abs(price - e20) <= pullbackZone
  ) {
    pullback = "BEARISH SETUP";
  }

  /*
    CONFIRMATION

    For RISE:
      bullish trend
      pullback near EMA20
      RSI above 50 but below 70
      latest price moving upward

    For FALL:
      bearish trend
      pullback near EMA20
      RSI below 50 but above 30
      latest price moving downward
  */

  let confirmation = "WAITING";
  let finalSignal = "WAIT";

  if (
    trend === "BULLISH" &&
    pullback === "BULLISH SETUP"
  ) {
    if (
      r > 50 &&
      r < 70 &&
      price > previousPrice
    ) {
      confirmation = "CONFIRMED ↑";
      finalSignal = "RISE";
    } else {
      confirmation = "WAITING ↑";
    }
  }

  if (
    trend === "BEARISH" &&
    pullback === "BEARISH SETUP"
  ) {
    if (
      r < 50 &&
      r > 30 &&
      price < previousPrice
    ) {
      confirmation = "CONFIRMED ↓";
      finalSignal = "FALL";
    } else {
      confirmation = "WAITING ↓";
    }
  }

  return {
    trend,
    pullback,
    confirmation,
    signal: finalSignal,
    ema20: e20,
    ema50: e50,
    rsi: r
  };
};

const signal = () => strategyState().signal;

/* -------------------------
   STRATEGY DISPLAY
------------------------- */

const updateStrategyDisplay = () => {
  const state = strategyState();

  $("#trend").textContent = state.trend;

  $("#ema20").textContent =
    state.ema20 == null
      ? "—"
      : state.ema20.toFixed(5);

  $("#ema50").textContent =
    state.ema50 == null
      ? "—"
      : state.ema50.toFixed(5);

  $("#rsiValue").textContent =
    state.rsi == null
      ? "—"
      : state.rsi.toFixed(1);

  $("#pullback").textContent =
    state.pullback;

  $("#confirmation").textContent =
    state.confirmation;

  $("#signal").textContent =
    state.signal;
};

/* -------------------------
   SCOREBOARD
------------------------- */

const updateScoreboard = () => {
  $("#tests").textContent = tests;

  $("#record").textContent =
    wins + " / " + losses;

  $("#accuracy").textContent =
    tests
      ? Math.round((wins / tests) * 100) + "%"
      : "—";
};

const updateBankroll = () => {
  const stake =
    Math.max(
      0,
      Number($("#stake").value) || 0
    );

  $("#currentCapital").textContent =
    "$" + currentCapital.toFixed(2);

  const pl =
    currentCapital - startingCapital;

  $("#sessionPL").textContent =
    (pl >= 0 ? "+$" : "-$") +
    Math.abs(pl).toFixed(2);

  $("#bankrollStatus").textContent =
    currentCapital >= stake &&
    stake > 0
      ? "READY"
      : "CAN'T FUND NEXT TEST";

  $("#actualPL").textContent =
    (actualDemoPL >= 0 ? "+$" : "-$") +
    Math.abs(actualDemoPL).toFixed(2);
};

/* -------------------------
   PAPER TEST ENGINE
------------------------- */

const validateSignal = price => {
  /*
    Finish an existing paper test first.
  */

  if (pendingTest) {
    pendingTest.ticksLeft--;

    if (pendingTest.ticksLeft <= 0) {
      const won =
        pendingTest.direction === "RISE"
          ? price > pendingTest.entry
          : price < pendingTest.entry;

      tests++;

      const stake =
        Math.max(
          0,
          Number($("#stake").value) || 0
        );

      if (won) {
        wins++;
        currentCapital += stake;
      } else {
        losses++;
        currentCapital =
          Math.max(
            0,
            currentCapital - stake
          );
      }

      pendingTest = null;

      /*
        Cooldown after each completed test.
        This helps stop rapid-fire signals.
      */
      cooldownTicks = 5;

      updateScoreboard();
      updateBankroll();
    }

    return;
  }

  /*
    Count cooldown only while there is
    no active paper test.
  */

  if (cooldownTicks > 0) {
    cooldownTicks--;
    return;
  }

  const s = signal();

  const stake =
    Math.max(
      0,
      Number($("#stake").value) || 0
    );

  const duration =
    Math.max(
      1,
      parseInt(
        $("#duration").value,
        10
      ) || 10
    );

  /*
    Start only when a fresh confirmed
    directional setup appears.
  */

  if (
    (s === "RISE" || s === "FALL") &&
    s !== lastSignal &&
    stake > 0 &&
    currentCapital >= stake
  ) {
    pendingTest = {
      direction: s,
      entry: price,
      ticksLeft: duration
    };
  }

  lastSignal = s;
};

/* -------------------------
   SERVER HELPERS
------------------------- */

async function get(url, opts) {
  const response =
    await fetch(url, opts);

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data.error ||
      "Request failed"
    );
  }

  return data;
}

const demoOnly = () => {
  const option =
    $("#account").selectedOptions[0];

  const name =
    String(
      option?.textContent || ""
    );

  const id =
    String(
      option?.value || ""
    );

  return (
    name.startsWith("Demo • ") &&
    id.length > 0
  );
};

/* -------------------------
   LOGIN / ACCOUNT INIT
------------------------- */

async function init() {
  const session =
    await get("/api/session");

  $("#login").style.display =
    session.authenticated
      ? "none"
      : "block";

  $("#logout").style.display =
    session.authenticated
      ? "block"
      : "none";

  $("#status").textContent =
    session.authenticated
      ? "Signed in securely. Loading accounts…"
      : "Not connected";

  if (!session.authenticated) {
    return;
  }

  try {
    const response =
      await get("/api/accounts");

    const list =
      response.data ||
      response.accounts ||
      [];

    const accounts =
      Array.isArray(list)
        ? list
        : (
            Array.isArray(list.accounts)
              ? list.accounts
              : []
          );

    $("#account").innerHTML = "";

    for (const account of accounts) {
      const id =
        account.account_id ||
        account.id ||
        account.loginid;

      const type =
        (
          account.account_type ||
          account.type ||
          ""
        )
          .toLowerCase();

      const isDemo =
        type.includes("demo") ||
        String(id || "")
          .startsWith("VRTC");

      if (id && isDemo) {
        const option =
          document.createElement("option");

        option.value = id;

        option.textContent =
          `Demo • ${id}`;

        $("#account").append(option);
      }
    }

    if (!$("#account").options.length) {
      const option =
        document.createElement("option");

      option.textContent =
       
