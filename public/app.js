const $ = s => document.querySelector(s);

/* =========================================================
   VELØRA
   Strategy B: EMA20 / EMA50 + RSI14
   Market: R_50

   DEMO
   • Automatic proposal
   • Automatic virtual-fund purchase
   • Contract monitoring

   REAL
   • Real-account connection
   • Strategy monitoring
   • Proposal preview
   • Server-side execution master lock
   • Three risk / legal confirmations
   • Explicit confirmation for EACH real-money order
   • No unattended real-money execution
   ========================================================= */


/* =========================================================
   CORE STATE
   ========================================================= */

const prices = [];

let tests = 0;
let wins = 0;
let losses = 0;

let pendingTest = null;
let lastSignal = "WAIT";

let startingCapital = 20;
let currentCapital = 20;

let cooldown = 0;

let ws = null;
let reconnectTimer = null;
let manualFeed = false;

let connectedAccountId = null;
let connectedAccountMode = null;

const accountInfo = new Map();


/* =========================================================
   SERVER / REAL EXECUTION STATE
   ========================================================= */

let serverConfig = {
  demoExecution: true,
  realAccountConnection: true,
  realProposalPreview: true,
  realExecutionEnabled: false
};

let realExecutionEnabled = false;
let realExecutionGateAllowed = false;

let realOrderAwaitingConfirmation = false;
let realPurchasePending = false;

let activeRealContractId = null;
let activeRealSubscriptionId = null;

let realTrades = 0;
let realWins = 0;
let realLosses = 0;
let realSessionPL = 0;


/* =========================================================
   ACCOUNT HELPERS
   ========================================================= */

function selectedAccountInfo() {
  const account = $("#account");

  if (!account) return null;

  return accountInfo.get(account.value) || null;
}

function selectedMode() {
  return selectedAccountInfo()?.mode || null;
}

function isDemoAccount() {
  return selectedMode() === "DEMO";
}

function isRealAccount() {
  return selectedMode() === "REAL";
}


/* =========================================================
   DEMO STATE
   ========================================================= */

let actualDemoPL = 0;

let demoTradeEnabled = false;
let demoTradePending = false;

let activeDemoContractId = null;
let activeDemoSubscriptionId = null;

let pendingDemoDirection = null;

let demoTrades = 0;
let demoWins = 0;
let demoLosses = 0;

const MAX_DEMO_TRADES = 20;


/* =========================================================
   LIVE / REAL STATE
   ========================================================= */

let liveArmed = false;
let liveProposalPending = false;

let liveSignals = 0;

let latestLiveProposalId = null;
let latestLiveProposalAsk = null;
let latestLiveProposalPayout = null;
let latestLiveDirection = null;
let latestLiveStake = null;
let latestLiveDuration = null;
const REAL_PROPOSAL_MAX_AGE_MS = 30000;

let latestLiveProposalCreatedAt = 0;
let realProposalExpiryTimer = null;


/* =========================================================
   REQUEST IDS
   ========================================================= */

const REQ = {
  SAFE_PROPOSAL: 501,

  DEMO_PROPOSAL: 601,
  DEMO_BUY: 602,
  DEMO_MONITOR: 603,

  LIVE_PROPOSAL: 701,
  REAL_BUY: 702,
  REAL_MONITOR: 703
};


/* =========================================================
   BASIC HELPERS
   ========================================================= */

function setText(selector, text) {
  const el = $(selector);

  if (el) {
    el.textContent = text;
  }
}

function setDisabled(selector, value) {
  const el = $(selector);

  if (el) {
    el.disabled = value;
  }
}

function numberValue(selector, fallback = 0) {
  const el = $(selector);

  if (!el) return fallback;

  const n = Number(el.value);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function integerValue(selector, fallback = 1) {
  const el = $(selector);

  if (!el) return fallback;

  const n = parseInt(el.value, 10);

  return Number.isFinite(n)
    ? n
    : fallback;
}

function money(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? "$" + n.toFixed(2)
    : "$0.00";
}

function signedMoney(value) {
  const n = Number(value) || 0;

  return (
    (n >= 0 ? "+$" : "-$") +
    Math.abs(n).toFixed(2)
  );
}


/* =========================================================
   SERVER HELPER
   ========================================================= */

async function get(url, opts) {
  const response =
    await fetch(url, opts);

  let data;

  try {
    data =
      await response.json();
  } catch {
    throw new Error(
      "Invalid server response"
    );
  }

  if (!response.ok) {
    const error =
      new Error(
        data.message ||
        data.error ||
        "Request failed"
      );

    error.status =
      response.status;

    error.data =
      data;

    throw error;
  }

  return data;
}


/* =========================================================
   MINDSET
   ========================================================= */

const winQuotes = [
  "Progress compounds when discipline stays consistent.",
  "Good trade. Protect the process that produced it.",
  "One clean win at a time. Stay selective.",
  "Momentum is earned — keep the same discipline.",
  "Green is progress, not permission to overtrade."
];

const lossQuotes = [
  "A loss is data. Discipline decides what happens next.",
  "Reset, review, and wait for the next clean setup.",
  "Protect the process — never chase a loss.",
  "One result does not define the system. Stay patient.",
  "Capital protection comes before getting even."
];

const winTips = [
  "Tip: Keep the stake unchanged after a win; avoid confidence-based sizing.",
  "Tip: Judge the setup quality, not just the last result.",
  "Tip: Respect the session trade limit even during a winning streak.",
  "Tip: Record the result and wait for the next confirmed setup."
];

const lossTips = [
  "Tip: Never increase stake just to recover the previous loss.",
  "Tip: Let the next confirmed setup come to you — do not force an entry.",
  "Tip: If the session loss limit is reached, stop the session.",
  "Tip: A skipped weak setup is better than an emotional trade."
];

function pickMessage(items) {
  return items[
    Math.floor(
      Math.random() * items.length
    )
  ];
}

function showTradeMessage(profit) {
  const n =
    Number(profit) || 0;

  if (n > 0) {
    setText(
      "#tradeQuote",
      pickMessage(winQuotes)
    );

    setText(
      "#tradeTip",
      pickMessage(winTips)
    );

    return;
  }

  if (n < 0) {
    setText(
      "#tradeQuote",
      pickMessage(lossQuotes)
    );

    setText(
      "#tradeTip",
      pickMessage(lossTips)
    );

    return;
  }

  setText(
    "#tradeQuote",
    "No edge in forcing the next trade."
  );

  setText(
    "#tradeTip",
    "Tip: Wait for a fully confirmed setup."
  );
}


/* =========================================================
   PAPER MEMORY
   ========================================================= */

function savePaperState() {
  try {
    localStorage.setItem(
      "bestiePaperState",
      JSON.stringify({
        tests,
        wins,
        losses,
        startingCapital,
        currentCapital
      })
    );
  } catch (e) {
    console.log(
      "Paper memory could not be saved",
      e
    );
  }
}

function loadPaperState() {
  try {
    const raw =
      localStorage.getItem(
        "bestiePaperState"
      );

    if (!raw) return;

    const saved =
      JSON.parse(raw);

    tests =
      Number(saved.tests) || 0;

    wins =
      Number(saved.wins) || 0;

    losses =
      Number(saved.losses) || 0;

    startingCapital =
      Number(
        saved.startingCapital
      ) || 20;

    currentCapital =
      Number(
        saved.currentCapital
      );

    if (
      !Number.isFinite(
        currentCapital
      )
    ) {
      currentCapital =
        startingCapital;
    }

  } catch (e) {
    console.log(
      "Paper memory could not be loaded",
      e
    );
  }
}


/* =========================================================
   INDICATORS
   ========================================================= */

function ema(values, period) {
  if (
    values.length < period
  ) {
    return null;
  }

  const k =
    2 / (period + 1);

  let result =
    values[0];

  for (
    let i = 1;
    i < values.length;
    i++
  ) {
    result =
      values[i] * k +
      result * (1 - k);
  }

  return result;
}

function rsi(values, period = 14) {
  if (
    values.length <
    period + 1
  ) {
    return null;
  }

  let gains = 0;
  let lossesValue = 0;

  for (
    let i =
      values.length - period;
    i < values.length;
    i++
  ) {
    const difference =
      values[i] -
      values[i - 1];

    if (difference > 0) {
      gains += difference;
    } else {
      lossesValue -=
        difference;
    }
  }

  if (lossesValue === 0) {
    return gains === 0
      ? 50
      : 100;
  }

  const rs =
    (gains / period) /
    (lossesValue / period);

  return (
    100 -
    (100 / (1 + rs))
  );
}


/* =========================================================
   STRATEGY B
   ========================================================= */

function strategy() {
  const e20 =
    ema(prices, 20);

  const e50 =
    ema(prices, 50);

  const r =
    rsi(prices, 14);

  if (
    e20 === null ||
    e50 === null ||
    r === null ||
    prices.length < 50
  ) {
    return {
      trend: "WAITING",
      pullback: "WAITING",
      confirmation: "WAITING",
      signal: "WAIT",
      e20,
      e50,
      r
    };
  }

  const price =
    prices[
      prices.length - 1
    ];

  const prev =
    prices[
      prices.length - 2
    ];

  let trend = "FLAT";

  if (e20 > e50) {
    trend = "BULLISH";
  }

  if (e20 < e50) {
    trend = "BEARISH";
  }

  const gap =
    Math.abs(
      e20 - e50
    );

  const minZone =
    Math.max(
      Math.abs(price) *
        0.00005,
      0.00001
    );

  const zone =
    Math.max(
      gap * 0.35,
      minZone
    );

  let pullback = "NO";

  if (
    trend === "BULLISH" &&
    Math.abs(
      price - e20
    ) <= zone
  ) {
    pullback =
      "BULLISH SETUP";
  }

  if (
    trend === "BEARISH" &&
    Math.abs(
      price - e20
    ) <= zone
  ) {
    pullback =
      "BEARISH SETUP";
  }

  let confirmation =
    "WAITING";

  let signal =
    "WAIT";

  if (
    pullback ===
    "BULLISH SETUP"
  ) {
    if (
      r > 50 &&
      r < 70 &&
      price > prev
    ) {
      confirmation =
        "CONFIRMED ↑";

      signal =
        "RISE";
    } else {
      confirmation =
        "WAITING ↑";
    }
  }

  if (
    pullback ===
    "BEARISH SETUP"
  ) {
    if (
      r < 50 &&
      r > 30 &&
      price < prev
    ) {
      confirmation =
        "CONFIRMED ↓";

      signal =
        "FALL";
    } else {
      confirmation =
        "WAITING ↓";
    }
  }

  return {
    trend,
    pullback,
    confirmation,
    signal,
    e20,
    e50,
    r
  };
}


/* =========================================================
   STRATEGY DISPLAY
   ========================================================= */

function displayStrategy() {
  const s =
    strategy();

  setText(
    "#trend",
    s.trend
  );

  setText(
    "#ema20",
    s.e20 === null
      ? "—"
      : s.e20.toFixed(5)
  );

  setText(
    "#ema50",
    s.e50 === null
      ? "—"
      : s.e50.toFixed(5)
  );

  setText(
    "#rsiValue",
    s.r === null
      ? "—"
      : s.r.toFixed(1)
  );

  setText(
    "#pullback",
    s.pullback
  );

  setText(
    "#confirmation",
    s.confirmation
  );

  setText(
    "#signal",
    s.signal
  );

  if (
    s.signal === "RISE"
  ) {
    setText(
      "#scannerText",
      "RISE"
    );

  } else if (
    s.signal === "FALL"
  ) {
    setText(
      "#scannerText",
      "FALL"
    );

  } else {
    setText(
      "#scannerText",
      prices.length < 50
        ? "BUILDING"
        : "SCANNING"
    );
  }
}


/* =========================================================
   SCOREBOARD / BANKROLL
   ========================================================= */

function scoreboard() {
  setText(
    "#tests",
    tests
  );

  setText(
    "#record",
    wins + " / " + losses
  );

  setText(
    "#accuracy",
    tests
      ? Math.round(
          wins /
          tests *
          100
        ) + "%"
      : "—"
  );
}

function bankroll() {
  const stake =
    Math.max(
      0,
      numberValue(
        "#stake",
        0
      )
    );

  setText(
    "#currentCapital",
    money(currentCapital)
  );

  const paperPL =
    currentCapital -
    startingCapital;

  setText(
    "#sessionPL",
    signedMoney(paperPL)
  );

  setText(
    "#actualPL",
    signedMoney(
      actualDemoPL
    )
  );

  setText(
    "#bankrollStatus",
    stake > 0 &&
    currentCapital >= stake
      ? "READY"
      : "CAN'T FUND NEXT TEST"
  );
}


/* =========================================================
   DEMO DISPLAY
   ========================================================= */

function updateDemoDisplay() {
  if (
    demoTradeEnabled
  ) {
    setText(
      "#demoTradeStatus",
      `Actual demo trading: ARMED • ${demoTrades} / ${MAX_DEMO_TRADES} • ${demoWins}W / ${demoLosses}L`
    );

    return;
  }

  if (
    activeDemoContractId
  ) {
    setText(
      "#demoTradeStatus",
      "Actual demo trading: STOPPING • current contract will settle"
    );

    return;
  }

  setText(
    "#demoTradeStatus",
    "Demo: ready when you are"
  );
}


/* =========================================================
   LIVE LIMITS
   ========================================================= */

function liveMaxStake() {
  return Math.max(
    0,
    numberValue(
      "#liveMaxStake",
      1
    )
  );
}

function liveMaxTrades() {
  return Math.max(
    1,
    integerValue(
      "#liveMaxTrades",
      5
    )
  );
}

function liveMaxLoss() {
  return Math.max(
    0,
    numberValue(
      "#liveMaxLoss",
      5
    )
  );
}

function liveLimitsValid() {
  const stake =
    numberValue(
      "#stake",
      0
    );

  const maxStake =
    liveMaxStake();

  const maxTrades =
    liveMaxTrades();

  const maxLoss =
    liveMaxLoss();

  if (
    !Number.isFinite(stake) ||
    stake <= 0
  ) {
    return {
      ok: false,
      reason:
        "INVALID STAKE"
    };
  }

  if (
    !Number.isFinite(maxStake) ||
    maxStake <= 0
  ) {
    return {
      ok: false,
      reason:
        "INVALID MAXIMUM STAKE"
    };
  }

  if (
    stake > maxStake
  ) {
    return {
      ok: false,
      reason:
        "STAKE EXCEEDS LIVE MAXIMUM"
    };
  }

  if (
    !Number.isFinite(maxTrades) ||
    maxTrades < 1
  ) {
    return {
      ok: false,
      reason:
        "INVALID TRADE LIMIT"
    };
  }

  if (
    !Number.isFinite(maxLoss) ||
    maxLoss <= 0
  ) {
    return {
      ok: false,
      reason:
        "INVALID LOSS LIMIT"
    };
  }

  if (
    realSessionPL <=
    -maxLoss
  ) {
    return {
      ok: false,
      reason:
        "SESSION LOSS LIMIT REACHED"
    };
  }

  if (
    realTrades >=
    maxTrades
  ) {
    return {
      ok: false,
      reason:
        "SESSION TRADE LIMIT REACHED"
    };
  }

  return {
    ok: true
  };
}


/* =========================================================
   LEGAL CONFIRMATIONS
   ========================================================= */

function allLiveConfirmationsAccepted() {
  return Boolean(
    $("#liveConfirm")?.checked &&
    $("#riskConfirm")?.checked &&
    $("#termsConfirm")?.checked
  );
}


/* =========================================================
   MODE PANELS
   ========================================================= */

function refreshVeloraPanels() {
  const mode =
    selectedMode();

  const demoControls =
    $("#demoControls");

  const liveControls =
    $("#liveControls");

  if (demoControls) {
    demoControls.style.display =
      mode === "DEMO"
        ? "block"
        : "none";
  }

  if (liveControls) {
    liveControls.style.display =
      mode === "REAL"
        ? "block"
        : "none";
  }
}


/* =========================================================
   REAL EXECUTION UI
   ========================================================= */

function clearRealOrderPreview() {
   if (realProposalExpiryTimer) {
  clearTimeout(realProposalExpiryTimer);
  realProposalExpiryTimer = null;
}

latestLiveProposalCreatedAt = 0;
  realOrderAwaitingConfirmation =
    false;

  realExecutionGateAllowed =
    false;

  const controls =
    $("#realExecutionControls");

  if (controls) {
    controls.hidden = true;
  }

  const confirm =
    $("#realOrderConfirm");

  if (confirm) {
    confirm.checked = false;
  }

  setDisabled(
    "#executeRealTrade",
    true
  );

  setText(
    "#realOrderDirection",
    "—"
  );

  setText(
    "#realOrderStake",
    "—"
  );

  setText(
    "#realOrderDuration",
    "—"
  );

  setText(
    "#realOrderAsk",
    "—"
  );

  setText(
    "#realOrderPayout",
    "—"
  );
}

function showRealOrderPreview() {
  if (
    !latestLiveProposalId ||
    !Number.isFinite(
      latestLiveProposalAsk
    )
  ) {
    clearRealOrderPreview();
    return;
  }

  const controls =
    $("#realExecutionControls");

  if (controls) {
    controls.hidden =
      !realExecutionEnabled;
  }

  setText(
    "#realOrderDirection",
    latestLiveDirection ||
    "—"
  );

  setText(
    "#realOrderStake",
    Number.isFinite(
      latestLiveStake
    )
      ? money(
          latestLiveStake
        )
      : "—"
  );

  setText(
    "#realOrderDuration",
    Number.isFinite(
      latestLiveDuration
    )
      ? `${latestLiveDuration} ticks`
      : "—"
  );

  setText(
    "#realOrderAsk",
    Number.isFinite(
      latestLiveProposalAsk
    )
      ? money(
          latestLiveProposalAsk
        )
      : "—"
  );

  setText(
    "#realOrderPayout",
    Number.isFinite(
      latestLiveProposalPayout
    )
      ? money(
          latestLiveProposalPayout
        )
      : "—"
  );

  realOrderAwaitingConfirmation =
    realExecutionEnabled;

  setDisabled(
    "#executeRealTrade",
    true
  );
}


/* =========================================================
   REAL EXECUTION MASTER STATUS
   ========================================================= */

function updateRealExecutionStatus() {
  if (
    realExecutionEnabled
  ) {
    setText(
      "#realExecutionBadge",
      "AVAILABLE"
    );

    setText(
      "#realExecutionMessage",
      "Server real-money execution gate is enabled. Every real order still requires explicit confirmation."
    );

    return;
  }

  setText(
    "#realExecutionBadge",
    "LOCKED"
  );

  setText(
    "#realExecutionMessage",
    "Real-money execution is locked by the VELØRA server. Real accounts may be used for market monitoring and proposal previews."
  );

  clearRealOrderPreview();
}

async function loadServerConfig() {
  try {
    const config =
      await get(
        "/api/config"
      );

    serverConfig = {
      ...serverConfig,
      ...config
    };

    realExecutionEnabled =
      config.realExecutionEnabled ===
      true;

  } catch (e) {
    realExecutionEnabled =
      false;
  }

  updateRealExecutionStatus();
}


/* =========================================================
   ACCOUNT UI
   ========================================================= */

function refreshAccountUI() {
  const mode =
    selectedMode();

  refreshVeloraPanels();

  setText(
    "#accountMode",
    mode ||
    "NOT CONNECTED"
  );

  setText(
    "#modeBadge",
    mode ||
    "SAFE"
  );

  if (
    mode === "DEMO"
  ) {
    setDisabled(
      "#startDemoTrades",
      demoTradeEnabled
    );

    setDisabled(
      "#startLiveTrades",
      true
    );

    return;
  }

  if (
    mode === "REAL"
  ) {
    setDisabled(
      "#startDemoTrades",
      true
    );

    setDisabled(
      "#startLiveTrades",
      !allLiveConfirmationsAccepted() ||
      liveArmed
    );

    return;
  }

  setDisabled(
    "#startDemoTrades",
    true
  );

  setDisabled(
    "#startLiveTrades",
    true
  );
}


/* =========================================================
   LIVE DISPLAY
   ========================================================= */

function updateLiveDisplay() {
  setText(
    "#liveTrades",
    realTrades
  );

  setText(
    "#liveRecord",
    `${realWins}W / ${realLosses}L`
  );

  setText(
    "#livePL",
    signedMoney(
      realSessionPL
    )
  );

  let safety =
    "LOCKED";

  if (
    activeRealContractId
  ) {
    safety =
      "REAL CONTRACT OPEN";

  } else if (
    realOrderAwaitingConfirmation
  ) {
    safety =
      "AWAITING CONFIRMATION";

  } else if (
    liveArmed
  ) {
    safety =
      realExecutionEnabled
        ? "ARMED • MANUAL CONFIRM"
        : "ARMED • PREVIEW ONLY";
  }

  setText(
    "#liveSafety",
    safety
  );
}


/* =========================================================
   STOP LIVE
   ========================================================= */

function stopLive(
  reason = "LOCKED"
) {
  liveArmed = false;
  liveProposalPending = false;

  latestLiveProposalId = null;
  latestLiveProposalAsk = null;
  latestLiveProposalPayout = null;
  latestLiveDirection = null;
  latestLiveStake = null;
  latestLiveDuration = null;

  clearRealOrderPreview();

  setDisabled(
    "#stopLiveTrades",
    true
  );

  refreshAccountUI();

  setText(
    "#liveTradeStatus",
    "LIVE trading: " +
    reason
  );

  updateLiveDisplay();
}


/* =========================================================
   ACCOUNT TYPE DETECTION
   ========================================================= */

function detectAccountMode(account) {
  const id =
    String(
      account.account_id ||
      account.id ||
      account.loginid ||
      ""
    );

  const type =
    String(
      account.account_type ||
      account.type ||
      ""
    ).toLowerCase();

  if (
    type.includes("demo") ||
    type.includes("virtual") ||
    id.startsWith("VRTC")
  ) {
    return "DEMO";
  }

  return "REAL";
}


/* =========================================================
   DEMO PROPOSAL
   ========================================================= */

function requestDemoProposal(direction) {
  if (
    !demoTradeEnabled
  ) {
    return false;
  }

  if (
    !isDemoAccount()
  ) {
    demoTradeEnabled =
      false;

    setText(
      "#demoTradeStatus",
      "Actual demo trading: DEMO ACCOUNT REQUIRED"
    );

    return false;
  }

  if (
    demoTrades >=
    MAX_DEMO_TRADES
  ) {
    finishDemoSession();
    return false;
  }

  if (
    !ws ||
    ws.readyState !==
      WebSocket.OPEN ||
    demoTradePending ||
    activeDemoContractId
  ) {
    return false;
  }

  const contractType =
    direction === "RISE"
      ? "CALL"
      : direction === "FALL"
        ? "PUT"
        : null;

  if (!contractType) {
    return false;
  }

  const stake =
    Math.max(
      0,
      numberValue(
        "#stake",
        0
      )
    );

  const duration =
    Math.max(
      1,
      integerValue(
        "#duration",
        10
      )
    );

  if (stake <= 0) {
    setText(
      "#demoTradeStatus",
      "Actual demo trading: INVALID STAKE"
    );

    return false;
  }

  demoTradePending =
    true;

  pendingDemoDirection =
    direction;

  ws.send(
    JSON.stringify({
      proposal: 1,
      amount: stake,
      basis: "stake",
      contract_type:
        contractType,
      currency: "USD",
      duration,
      duration_unit: "t",
      underlying_symbol:
        "R_50",
      req_id:
        REQ.DEMO_PROPOSAL
    })
  );

  return true;
}


/* =========================================================
   DEMO PURCHASE
   ========================================================= */

function buyDemoProposal(
  proposalId,
  askPrice
) {
  if (
    !demoTradeEnabled ||
    !isDemoAccount()
  ) {
    demoTradePending =
      false;

    pendingDemoDirection =
      null;

    return false;
  }

  if (
    !ws ||
    ws.readyState !==
      WebSocket.OPEN
  ) {
    demoTradePending =
      false;

    pendingDemoDirection =
      null;

    return false;
  }

  if (
    !proposalId ||
    !demoTradePending ||
    activeDemoContractId
  ) {
    return false;
  }

  const price =
    Number(askPrice);

  if (
    !Number.isFinite(price) ||
    price <= 0
  ) {
    demoTradePending =
      false;

    pendingDemoDirection =
      null;

    return false;
  }

  ws.send(
    JSON.stringify({
      buy:
        String(
          proposalId
        ),
      price,
      req_id:
        REQ.DEMO_BUY
    })
  );

  return true;
}


/* =========================================================
   LIVE PROPOSAL
   ========================================================= */

function requestLiveProposal(direction) {
  if (!liveArmed) {
    return false;
  }

  if (
    !isRealAccount()
  ) {
    stopLive(
      "REAL ACCOUNT REQUIRED"
    );

    return false;
  }

  if (
    connectedAccountMode !==
    "REAL"
  ) {
    stopLive(
      "CONNECTED ACCOUNT IS NOT REAL"
    );

    return false;
  }

  if (
    !ws ||
    ws.readyState !==
      WebSocket.OPEN ||
    liveProposalPending ||
    realPurchasePending ||
    activeRealContractId ||
    realOrderAwaitingConfirmation
  ) {
    return false;
  }

  const limits =
    liveLimitsValid();

  if (!limits.ok) {
    stopLive(
      limits.reason
    );

    return false;
  }

  if (
    liveSignals >=
    liveMaxTrades()
  ) {
    stopLive(
      "SESSION SIGNAL LIMIT REACHED"
    );

    return false;
  }

  const contractType =
    direction === "RISE"
      ? "CALL"
      : direction === "FALL"
        ? "PUT"
        : null;

  if (!contractType) {
    return false;
  }

  const stake =
    numberValue(
      "#stake",
      0
    );

  const duration =
    Math.max(
      1,
      integerValue(
        "#duration",
        10
      )
    );

  latestLiveStake =
    stake;

  latestLiveDuration =
    duration;

  latestLiveDirection =
    direction;

  liveProposalPending =
    true;

  ws.send(
    JSON.stringify({
      proposal: 1,
      amount: stake,
      basis: "stake",
      contract_type:
        contractType,
      currency: "USD",
      duration,
      duration_unit: "t",
      underlying_symbol:
        "R_50",
      req_id:
        REQ.LIVE_PROPOSAL
    })
  );

  setText(
    "#liveTradeStatus",
    "LIVE: requesting " +
    direction +
    " proposal…"
  );

  return true;
}


/* =========================================================
   REAL SERVER GATE
   ========================================================= */

async function checkRealExecutionGate() {
  if (
    !realExecutionEnabled
  ) {
    throw new Error(
      "Real-money execution is locked by the VELØRA server."
    );
  }

  const result =
    await get(
      "/api/real-execution/check",
      {
        method: "POST"
      }
    );

  if (
    result.allowed !== true
  ) {
    throw new Error(
      result.message ||
      "Real-money execution is not available."
    );
  }

  return true;
}


/* =========================================================
   EXPLICIT REAL PURCHASE
   ========================================================= */

async function executeConfirmedRealOrder() {
  if (
    realPurchasePending
  ) {
    return;
  }

  if (
    !realOrderAwaitingConfirmation ||
    !latestLiveProposalId
  ) {
    setText(
      "#liveTradeStatus",
      "LIVE: no confirmed proposal is waiting"
    );

    return;
  }

  if (
    !$("#realOrderConfirm")?.checked
  ) {
    setText(
      "#liveTradeStatus",
      "LIVE: confirm this specific transaction first"
    );

    return;
  }

  if (
    !allLiveConfirmationsAccepted()
  ) {
    stopLive(
      "LOCKED • required confirmations missing"
    );

    return;
  }

  if (
    !isRealAccount() ||
    connectedAccountMode !==
      "REAL"
  ) {
    stopLive(
      "REAL ACCOUNT REQUIRED"
    );

    return;
  }

  if (
    !ws ||
    ws.readyState !==
      WebSocket.OPEN
  ) {
    stopLive(
      "LOCKED • connection unavailable"
    );

    return;
  }

  const limits =
    liveLimitsValid();

  if (!limits.ok) {
    stopLive(
      limits.reason
    );

    return;
  }

  /*
     The proposal must still match the
     current user-controlled settings.
  */

  const currentStake =
    numberValue(
      "#stake",
      0
    );

  const currentDuration =
    Math.max(
      1,
      integerValue(
        "#duration",
        10
      )
    );

  if (
    currentStake !==
      latestLiveStake ||
    currentDuration !==
      latestLiveDuration
  ) {
    stopLive(
      "LOCKED • order settings changed"
    );

    return;
  }

  try {
    setDisabled(
      "#executeRealTrade",
      true
    );

    setText(
      "#liveTradeStatus",
      "LIVE: verifying server execution gate…"
    );

    await checkRealExecutionGate();

    realExecutionGateAllowed =
      true;

    if (
      !realExecutionGateAllowed
    ) {
      throw new Error(
        "Server execution gate rejected the order."
      );
    }

    realPurchasePending =
      true;

    realOrderAwaitingConfirmation =
      false;

    ws.send(
      JSON.stringify({
        buy:
          String(
            latestLiveProposalId
          ),

        price:
          Number(
            latestLiveProposalAsk
          ),

        req_id:
          REQ.REAL_BUY
      })
    );

    setText(
      "#liveTradeStatus",
      "LIVE: confirmed real-money order submitted…"
    );

    updateLiveDisplay();

  } catch (e) {
    realPurchasePending =
      false;

    realExecutionGateAllowed =
      false;

    setText(
      "#liveTradeStatus",
      "LIVE: " +
      e.message
    );

    updateLiveDisplay();
  }
}


/* =========================================================
   DEMO SESSION END
   ========================================================= */

function finishDemoSession() {
  demoTradeEnabled =
    false;

  demoTradePending =
    false;

  setDisabled(
    "#startDemoTrades",
    false
  );

  setDisabled(
    "#stopDemoTrades",
    true
  );

  setText(
    "#demoTradeStatus",
    `Actual demo trading: TEST COMPLETE • ${demoTrades} / ${MAX_DEMO_TRADES} • ${demoWins}W / ${demoLosses}L`
  );
}


/* =========================================================
   PAPER + SIGNAL ENGINE
   ========================================================= */

function testSignal(price) {
  if (pendingTest) {
    pendingTest.left--;

    if (
      pendingTest.left <= 0
    ) {
      const won =
        pendingTest.direction ===
        "RISE"
          ? price >
            pendingTest.entry
          : price <
            pendingTest.entry;

      const stake =
        Math.max(
          0,
          numberValue(
            "#stake",
            0
          )
        );

      tests++;

      if (won) {
        wins++;
        currentCapital +=
          stake;
      } else {
        losses++;
        currentCapital =
          Math.max(
            0,
            currentCapital -
            stake
          );
      }

      pendingTest =
        null;

      cooldown = 5;

      scoreboard();
      bankroll();
      savePaperState();
    }

    return;
  }

  if (cooldown > 0) {
    cooldown--;
    return;
  }

  const s =
    strategy().signal;

  const stake =
    Math.max(
      0,
      numberValue(
        "#stake",
        0
      )
    );

  const duration =
    Math.max(
      1,
      integerValue(
        "#duration",
        10
      )
    );

  if (
    (
      s === "RISE" ||
      s === "FALL"
    ) &&
    s !== lastSignal
  ) {
    if (
      stake > 0 &&
      currentCapital >= stake
    ) {
      pendingTest = {
        direction: s,
        entry: price,
        left: duration
      };
    }

    if (
      demoTradeEnabled &&
      isDemoAccount()
    ) {
      const sent =
        requestDemoProposal(s);

      setText(
        "#demoTradeStatus",
        sent
          ? "Actual demo trading: PROPOSAL SENT • " + s
          : "Actual demo trading: SIGNAL SEEN BUT PROPOSAL BLOCKED • " + s
      );
    }

    if (
      liveArmed &&
      isRealAccount()
    ) {
      requestLiveProposal(s);
    }
  }

  lastSignal = s;
}


/* =========================================================
   INITIAL LOGIN / ACCOUNTS
   ========================================================= */

async function init() {
  try {
    await loadServerConfig();

    const session =
      await get(
        "/api/session"
      );

    const login =
      $("#login");

    const logout =
      $("#logout");

    if (login) {
      login.style.display =
        session.authenticated
          ? "none"
          : "block";
    }

    if (logout) {
      logout.style.display =
        session.authenticated
          ? "block"
          : "none";
    }

    if (
      session.realExecutionEnabled ===
      true
    ) {
      realExecutionEnabled =
        true;

      updateRealExecutionStatus();
    }

    if (
      !session.authenticated
    ) {
      setText(
        "#status",
        "Not connected"
      );

      refreshAccountUI();
      return;
    }

    setText(
      "#status",
      "Signed in securely. Loading accounts…"
    );

    const accountsResponse =
      await get(
        "/api/accounts"
      );

    const raw =
      accountsResponse.data ||
      accountsResponse.accounts ||
      [];

    const arr =
      Array.isArray(raw)
        ? raw
        : Array.isArray(
            raw.accounts
          )
          ? raw.accounts
          : [];

    const account =
      $("#account");

    if (!account) {
      throw new Error(
        "Account selector missing"
      );
    }

    account.innerHTML = "";
    accountInfo.clear();

    for (const x of arr) {
      const id =
        x.account_id ||
        x.id ||
        x.loginid;

      if (!id) continue;

      const mode =
        detectAccountMode(x);

      accountInfo.set(
        String(id),
        {
          id: String(id),
          mode,
          raw: x
        }
      );

      const option =
        document.createElement(
          "option"
        );

      option.value =
        String(id);

      option.textContent =
        mode +
        " • " +
        id;

      account.append(option);
    }

    if (
      !account.options.length
    ) {
      const option =
        document.createElement(
          "option"
        );

      option.value = "";

      option.textContent =
        "No trading account detected";

      account.append(option);
    }

    setDisabled(
      "#connect",
      !account.value
    );

    refreshAccountUI();

    setText(
      "#status",
      "Connected. Select account and connect R_50 feed."
    );

  } catch (e) {
    setText(
      "#status",
      "INIT ERROR: " +
      e.message
    );
  }
}


/* =========================================================
   LOGIN / LOGOUT
   ========================================================= */

const loginButton =
  $("#login");

if (loginButton) {
  loginButton.onclick =
    () => {
      location.href =
        "/auth/login";
    };
}

const logoutButton =
  $("#logout");

if (logoutButton) {
  logoutButton.onclick =
    async () => {
      try {
        await get(
          "/api/logout",
          {
            method: "POST"
          }
        );
      } finally {
        location.reload();
      }
    };
}


/* =========================================================
   ACCOUNT CHANGE
   ========================================================= */

const accountSelect =
  $("#account");

if (accountSelect) {
  accountSelect.onchange =
    () => {
      demoTradeEnabled =
        false;

      demoTradePending =
        false;

      liveArmed =
        false;

      liveProposalPending =
        false;

      realPurchasePending =
        false;

      latestLiveProposalId =
        null;

      latestLiveProposalAsk =
        null;

      latestLiveProposalPayout =
        null;

      latestLiveDirection =
        null;

      latestLiveStake =
        null;

      latestLiveDuration =
        null;

      liveSignals = 0;

      manualFeed =
        false;

      clearRealOrderPreview();

      clearTimeout(
        reconnectTimer
      );

      if (ws) {
        try {
          ws.close();
        } catch {}
      }

      ws = null;

      connectedAccountId =
        null;

      connectedAccountMode =
        null;

      prices.length = 0;

      pendingTest =
        null;

      lastSignal =
        "WAIT";

      cooldown = 0;

      setDisabled(
        "#connect",
        !accountSelect.value
      );

      setDisabled(
        "#stopDemoTrades",
        true
      );

      setDisabled(
        "#stopLiveTrades",
        true
      );

      setText(
        "#demoTradeStatus",
        "Demo: ready when you are"
      );

      setText(
        "#liveTradeStatus",
        "LIVE trading: LOCKED"
      );

      setText(
        "#status",
        "Account changed • connect R_50 feed"
      );

      setText(
        "#scannerText",
        "READY"
      );

      refreshAccountUI();
      updateLiveDisplay();
    };
}


/* =========================================================
   CONFIRMATION HANDLERS
   ========================================================= */

[
  "#liveConfirm",
  "#riskConfirm",
  "#termsConfirm"
].forEach(selector => {
  const el =
    $(selector);

  if (!el) return;

  el.addEventListener(
    "change",
    () => {
      if (
        liveArmed &&
        !allLiveConfirmationsAccepted()
      ) {
        stopLive(
          "LOCKED • confirmation removed"
        );
      }

      refreshAccountUI();
    }
  );
});

const realOrderConfirm =
  $("#realOrderConfirm");

if (realOrderConfirm) {
  realOrderConfirm.onchange =
    () => {
      setDisabled(
        "#executeRealTrade",
        !(
          realOrderConfirm.checked &&
          realOrderAwaitingConfirmation &&
          realExecutionEnabled &&
          !realPurchasePending
        )
      );
    };
}

const executeRealTradeButton =
  $("#executeRealTrade");

if (
  executeRealTradeButton
) {
  executeRealTradeButton.onclick =
    executeConfirmedRealOrder;
}


/* =========================================================
   CONNECT MARKET
   ========================================================= */

const connectButton =
  $("#connect");

if (connectButton) {
  connectButton.onclick =
    () => {
      if (manualFeed) {
        return;
      }

      if (
        !$("#account")?.value
      ) {
        setText(
          "#status",
          "Select an account first"
        );

        return;
      }

      manualFeed =
        true;

      setDisabled(
        "#connect",
        true
      );

      connectFeed();
    };
}


/* =========================================================
   WEBSOCKET CONNECTION
   ========================================================= */

async function connectFeed() {
  if (!manualFeed) {
    return;
  }

  const account =
    $("#account");

  if (
    !account ||
    !account.value
  ) {
    manualFeed =
      false;

    setText(
      "#status",
      "Account required"
    );

    return;
  }

  try {
    clearTimeout(
      reconnectTimer
    );

    if (
      ws &&
      (
        ws.readyState ===
          WebSocket.OPEN ||
        ws.readyState ===
          WebSocket.CONNECTING
      )
    ) {
      try {
        ws.close();
      } catch {}
    }

    const id =
      account.value;

    const info =
      accountInfo.get(id);

    if (!info) {
      throw new Error(
        "Unknown account"
      );
    }

    connectedAccountId =
      id;

    connectedAccountMode =
      info.mode;

    setText(
      "#status",
      "Connecting " +
      info.mode +
      " account to R_50…"
    );

    const otp =
      await get(
        "/api/otp/" +
        encodeURIComponent(id),
        {
          method: "POST"
        }
      );

    if (
      !otp ||
      !otp.data ||
      !otp.data.url
    ) {
      throw new Error(
        "No WebSocket URL received"
      );
    }

    /*
       Server metadata must agree with
       the browser's selected account.
    */

    if (
      otp.velora?.accountMode &&
      otp.velora.accountMode !==
        info.mode
    ) {
      throw new Error(
        "Account mode verification failed"
      );
    }

    if (
      otp.velora &&
      typeof otp.velora
        .realExecutionEnabled ===
        "boolean"
    ) {
      realExecutionEnabled =
        otp.velora
          .realExecutionEnabled;

      updateRealExecutionStatus();
    }

    ws =
      new WebSocket(
        otp.data.url
      );


    /* =====================================================
       SOCKET OPEN
       ===================================================== */

    ws.onopen =
      () => {
        ws.send(
          JSON.stringify({
            ticks: "R_50",
            subscribe: 1
          })
        );

        ws.send(
          JSON.stringify({
            contracts_for:
              "R_50"
          })
        );

        const duration =
          Math.max(
            1,
            integerValue(
              "#duration",
              10
            )
          );

        ws.send(
          JSON.stringify({
            proposal: 1,
            amount: 1,
            basis: "stake",
            contract_type:
              "CALL",
            currency: "USD",
            duration,
            duration_unit:
              "t",
            underlying_symbol:
              "R_50",
            req_id:
              REQ.SAFE_PROPOSAL
          })
        );

        if (
          activeDemoContractId &&
          connectedAccountMode ===
            "DEMO"
        ) {
          ws.send(
            JSON.stringify({
              proposal_open_contract:
                1,
              contract_id:
                activeDemoContractId,
              subscribe: 1,
              req_id:
                REQ.DEMO_MONITOR
            })
          );
        }

        if (
          activeRealContractId &&
          connectedAccountMode ===
            "REAL"
        ) {
          ws.send(
            JSON.stringify({
              proposal_open_contract:
                1,
              contract_id:
                activeRealContractId,
              subscribe: 1,
              req_id:
                REQ.REAL_MONITOR
            })
          );
        }

        setText(
          "#status",
          "R_50 feed connected ✓ • " +
          connectedAccountMode
        );
      };


    /* =====================================================
       SOCKET MESSAGE
       ===================================================== */

    ws.onmessage =
      event => {
        let m;

        try {
          m =
            JSON.parse(
              event.data
            );
        } catch {
          return;
        }


        /* -------------------------------------------------
           DEMO PROPOSAL
           ------------------------------------------------- */

        if (
          m.req_id ===
          REQ.DEMO_PROPOSAL
        ) {
          if (m.error) {
            demoTradePending =
              false;

            pendingDemoDirection =
              null;

            setText(
              "#demoTradeStatus",
              "Actual demo trading: PROPOSAL ERROR • " +
              (
                m.error.message ||
                "Unknown"
              )
            );

            return;
          }

          if (m.proposal) {
            const proposalId =
              m.proposal.id;

            const askPrice =
              Number(
                m.proposal
                  .ask_price
              );

            if (
              !demoTradeEnabled ||
              !isDemoAccount()
            ) {
              demoTradePending =
                false;

              pendingDemoDirection =
                null;

              return;
            }

            buyDemoProposal(
              proposalId,
              askPrice
            );

            return;
          }
        }


        /* -------------------------------------------------
           DEMO BUY
           ------------------------------------------------- */

        if (
          m.req_id ===
          REQ.DEMO_BUY
        ) {
          if (m.error) {
            demoTradePending =
              false;

            pendingDemoDirection =
              null;

            activeDemoContractId =
              null;

            setText(
              "#demoTradeStatus",
              "Actual demo trading: BUY ERROR • " +
              (
                m.error.message ||
                "Unknown"
              )
            );

            return;
          }

          if (
            m.buy &&
            m.buy.contract_id
          ) {
            activeDemoContractId =
              m.buy.contract_id;

            demoTradePending =
              false;

            ws.send(
              JSON.stringify({
                proposal_open_contract:
                  1,
                contract_id:
                  activeDemoContractId,
                subscribe: 1,
                req_id:
                  REQ.DEMO_MONITOR
              })
            );

            setText(
              "#demoTradeStatus",
              "Actual demo trading: CONTRACT OPEN • " +
              (
                pendingDemoDirection ||
                "UNKNOWN"
              )
            );

            return;
          }
        }


        /* -------------------------------------------------
           DEMO MONITOR
           ------------------------------------------------- */

        if (
          m.req_id ===
            REQ.DEMO_MONITOR &&
          m.proposal_open_contract
        ) {
          const contract =
            m.proposal_open_contract;

          if (
            Number(
              contract.contract_id
            ) !==
            Number(
              activeDemoContractId
            )
          ) {
            return;
          }

          if (
            m.subscription?.id
          ) {
            activeDemoSubscriptionId =
              m.subscription.id;
          }

          if (
            contract.is_sold
          ) {
            const profit =
              Number(
                contract.profit
              ) || 0;

            actualDemoPL +=
              profit;

            demoTrades++;

            if (profit > 0) {
              demoWins++;
            } else if (
              profit < 0
            ) {
              demoLosses++;
            }

            showTradeMessage(
              profit
            );

            activeDemoContractId =
              null;

            pendingDemoDirection =
              null;

            demoTradePending =
              false;

            if (
              activeDemoSubscriptionId &&
              ws?.readyState ===
                WebSocket.OPEN
            ) {
              try {
                ws.send(
                  JSON.stringify({
                    forget:
                      activeDemoSubscriptionId
                  })
                );
              } catch {}
            }

            activeDemoSubscriptionId =
              null;

            bankroll();

            if (
              demoTrades >=
              MAX_DEMO_TRADES
            ) {
              finishDemoSession();
              return;
            }

            setText(
              "#demoTradeStatus",
              `Actual demo trading: SETTLED • ${signedMoney(profit)} • ${demoTrades} / ${MAX_DEMO_TRADES} • ${demoWins}W / ${demoLosses}L`
            );

            return;
          }
        }


        /* -------------------------------------------------
           REAL PROPOSAL
           ------------------------------------------------- */

        if (
          m.req_id ===
          REQ.LIVE_PROPOSAL
        ) {
          liveProposalPending =
            false;

          if (m.error) {
            latestLiveProposalId =
              null;

            latestLiveProposalAsk =
              null;

            latestLiveProposalPayout =
              null;

            clearRealOrderPreview();

            setText(
              "#liveTradeStatus",
              "LIVE proposal error • " +
              (
                m.error.message ||
                "Unknown"
              )
            );

            return;
          }

          if (m.proposal) {
            latestLiveProposalId =
              m.proposal.id ||
              null;

            latestLiveProposalAsk =
              Number(
                m.proposal
                  .ask_price
              );

            latestLiveProposalPayout =
              Number(
                m.proposal
                  .payout
              );
             latestLiveProposalCreatedAt = Date.now();

if (realProposalExpiryTimer) {
  clearTimeout(realProposalExpiryTimer);
}

realProposalExpiryTimer = setTimeout(() => {
  clearRealOrderPreview();
}, REAL_PROPOSAL_MAX_AGE_MS);

            liveSignals++;

            const askText =
              Number.isFinite(
                latestLiveProposalAsk
              )
                ? money(
                    latestLiveProposalAsk
                  )
                : "—";

            const payoutText =
              Number.isFinite(
                latestLiveProposalPayout
              )
                ? money(
                    latestLiveProposalPayout
                  )
                : "—";

            if (
              realExecutionEnabled
            ) {
              showRealOrderPreview();

              setText(
                "#liveTradeStatus",
                `LIVE PROPOSAL • ${latestLiveDirection} • Ask ${askText} • Payout ${payoutText} • awaiting explicit order confirmation`
              );
            } else {
              clearRealOrderPreview();

              setText(
                "#liveTradeStatus",
                `LIVE PREVIEW • ${latestLiveDirection} • Ask ${askText} • Payout ${payoutText} • SERVER EXECUTION LOCKED`
              );
            }

            updateLiveDisplay();

            return;
          }
        }


        /* -------------------------------------------------
           REAL BUY RESPONSE
           ------------------------------------------------- */

        if (
          m.req_id ===
          REQ.REAL_BUY
        ) {
          realPurchasePending =
            false;

          realExecutionGateAllowed =
            false;

          if (m.error) {
            setText(
              "#liveTradeStatus",
              "LIVE BUY ERROR • " +
              (
                m.error.message ||
                "Unknown"
              )
            );

            clearRealOrderPreview();
            updateLiveDisplay();

            return;
          }

          if (
            m.buy &&
            m.buy.contract_id
          ) {
            activeRealContractId =
              m.buy.contract_id;

            clearRealOrderPreview();

            ws.send(
              JSON.stringify({
                proposal_open_contract:
                  1,
                contract_id:
                  activeRealContractId,
                subscribe: 1,
                req_id:
                  REQ.REAL_MONITOR
              })
            );

            setText(
              "#liveTradeStatus",
              "LIVE REAL-MONEY CONTRACT OPEN • monitoring settlement"
            );

            updateLiveDisplay();

            return;
          }
        }


        /* -------------------------------------------------
           REAL CONTRACT MONITOR
           ------------------------------------------------- */

        if (
          m.req_id ===
            REQ.REAL_MONITOR &&
          m.proposal_open_contract
        ) {
          const contract =
            m.proposal_open_contract;

          if (
            Number(
              contract.contract_id
            ) !==
            Number(
              activeRealContractId
            )
          ) {
            return;
          }

          if (
            m.subscription?.id
          ) {
            activeRealSubscriptionId =
              m.subscription.id;
          }

          if (
            contract.is_sold
          ) {
            const profit =
              Number(
                contract.profit
              ) || 0;

            realTrades++;
            realSessionPL +=
              profit;

            if (profit > 0) {
              realWins++;
            } else if (
              profit < 0
            ) {
              realLosses++;
            }

            showTradeMessage(
              profit
            );

            activeRealContractId =
              null;

            if (
              activeRealSubscriptionId &&
              ws?.readyState ===
                WebSocket.OPEN
            ) {
              try {
                ws.send(
                  JSON.stringify({
                    forget:
                      activeRealSubscriptionId
                  })
                );
              } catch {}
            }

            activeRealSubscriptionId =
              null;

            latestLiveProposalId =
              null;

            latestLiveProposalAsk =
              null;

            latestLiveProposalPayout =
              null;

            latestLiveDirection =
              null;

            latestLiveStake =
              null;

            latestLiveDuration =
              null;

            updateLiveDisplay();

            const limits =
              liveLimitsValid();

            if (!limits.ok) {
              stopLive(
                limits.reason
              );

              return;
            }

            setText(
              "#liveTradeStatus",
              `LIVE SETTLED • ${signedMoney(profit)} • ${realTrades} trade${realTrades === 1 ? "" : "s"} this session`
            );

            return;
          }
        }


        /* -------------------------------------------------
           SAFE PROPOSAL
           ------------------------------------------------- */

        if (
          m.req_id ===
          REQ.SAFE_PROPOSAL
        ) {
          if (m.proposal) {
            setText(
              "#proposalCheck",
              "Ask: $" +
              m.proposal.ask_price +
              " • Payout: $" +
              m.proposal.payout +
              " ✓"
            );
          }

          if (m.error) {
            setText(
              "#proposalCheck",
              "ERROR"
            );

            setText(
              "#status",
              "PROPOSAL ERROR: " +
              (
                m.error.message ||
                "Unknown"
              )
            );
          }
        }


        /* -------------------------------------------------
           CONTRACT MAPPING
           ------------------------------------------------- */

        if (
          m.contracts_for
        ) {
          const available =
            m.contracts_for
              .available ||
            [];

          const call =
            available.some(
              x =>
                x.contract_type ===
                "CALL"
            );

          const put =
            available.some(
              x =>
                x.contract_type ===
                "PUT"
            );

          setText(
            "#contractCheck",
            call && put
              ? "RISE → CALL ✓ • FALL → PUT ✓"
              : "CHECK CONTRACT MAPPING"
          );
        }


        /* -------------------------------------------------
           MARKET TICK
           ------------------------------------------------- */

        if (m.tick) {
          const price =
            Number(
              m.tick.quote
            );

          if (
            !Number.isFinite(
              price
            )
          ) {
            return;
          }

          prices.push(price);

          if (
            prices.length > 500
          ) {
            prices.shift();
          }

          testSignal(price);
          displayStrategy();

          setText(
            "#status",
            `R_50 • ${price} • Memory ${prices.length} • ${connectedAccountMode || "UNKNOWN"}`
          );
        }
      };


    /* =====================================================
       SOCKET ERROR
       ===================================================== */

    ws.onerror =
      () => {
        try {
          ws.close();
        } catch {}
      };


    /* =====================================================
       SOCKET CLOSE
       ===================================================== */

    ws.onclose =
      () => {
        demoTradePending =
          false;

        liveProposalPending =
          false;

        realPurchasePending =
          false;

        latestLiveProposalId =
          null;

        latestLiveProposalAsk =
          null;

        latestLiveProposalPayout =
          null;

        clearRealOrderPreview();

        if (
          !activeDemoContractId
        ) {
          pendingDemoDirection =
            null;
        }

        if (liveArmed) {
          stopLive(
            "LOCKED • connection interrupted"
          );
        }

        if (manualFeed) {
          setText(
            "#status",
            "Feed disconnected • reconnecting…"
          );

          clearTimeout(
            reconnectTimer
          );

          reconnectTimer =
            setTimeout(
              connectFeed,
              3000
            );
        }
      };

  } catch (e) {
    setText(
      "#status",
      "Feed error: " +
      e.message
    );

    if (liveArmed) {
      stopLive(
        "LOCKED • connection error"
      );
    }

    if (manualFeed) {
      clearTimeout(
        reconnectTimer
      );

      reconnectTimer =
        setTimeout(
          connectFeed,
          3000
        );
    }
  }
}


/* =========================================================
   PAPER CAPITAL RESET
   ========================================================= */

const capitalInput =
  $("#capital");

if (capitalInput) {
  capitalInput.onchange =
    () => {
      const value =
        Number(
          capitalInput.value
        );

      if (
        !Number.isFinite(
          value
        ) ||
        value <= 0
      ) {
        capitalInput.value =
          startingCapital
            .toFixed(2);

        return;
      }

      startingCapital =
        value;

      currentCapital =
        value;

      tests = 0;
      wins = 0;
      losses = 0;

      pendingTest =
        null;

      lastSignal =
        "WAIT";

      cooldown = 0;

      scoreboard();
      bankroll();
      savePaperState();
    };
}


/* =========================================================
   START DEMO
   ========================================================= */

const startDemoButton =
  $("#startDemoTrades");

if (startDemoButton) {
  startDemoButton.onclick =
    () => {
      if (
        !isDemoAccount()
      ) {
        setText(
          "#demoTradeStatus",
          "Actual demo trading: DEMO ACCOUNT REQUIRED"
        );

        return;
      }

      if (
        !ws ||
        ws.readyState !==
          WebSocket.OPEN
      ) {
        setText(
          "#demoTradeStatus",
          "Actual demo trading: CONNECT FEED FIRST"
        );

        return;
      }

      if (
        connectedAccountMode !==
        "DEMO"
      ) {
        setText(
          "#demoTradeStatus",
          "Actual demo trading: WRONG CONNECTED ACCOUNT"
        );

        return;
      }

      if (
        demoTradePending ||
        activeDemoContractId
      ) {
        setText(
          "#demoTradeStatus",
          "Actual demo trading: CONTRACT ALREADY ACTIVE"
        );

        return;
      }

      const stake =
        Math.max(
          0,
          numberValue(
            "#stake",
            0
          )
        );

      if (stake <= 0) {
        setText(
          "#demoTradeStatus",
          "Actual demo trading: ENTER A VALID STAKE"
        );

        return;
      }

      demoTrades = 0;
      demoWins = 0;
      demoLosses = 0;

      actualDemoPL = 0;

      demoTradePending =
        false;

      activeDemoContractId =
        null;

      activeDemoSubscriptionId =
        null;

      pendingDemoDirection =
        null;

      lastSignal =
        "WAIT";

      demoTradeEnabled =
        true;

      setDisabled(
        "#startDemoTrades",
        true
      );

      setDisabled(
        "#stopDemoTrades",
        false
      );

      setText(
        "#demoTradeStatus",
        "Actual demo trading: ARMED • 0 / " +
        MAX_DEMO_TRADES
      );

      bankroll();
    };
}


/* =========================================================
   STOP DEMO
   ========================================================= */

const stopDemoButton =
  $("#stopDemoTrades");

if (stopDemoButton) {
  stopDemoButton.onclick =
    () => {
      demoTradeEnabled =
        false;

      if (
        !activeDemoContractId
      ) {
        demoTradePending =
          false;

        pendingDemoDirection =
          null;
      }

      setDisabled(
        "#startDemoTrades",
        false
      );

      setDisabled(
        "#stopDemoTrades",
        true
      );

      setText(
        "#demoTradeStatus",
        activeDemoContractId
          ? "Actual demo trading: STOPPING • current contract will settle"
          : "Demo: ready when you are"
      );
    };
}


/* =========================================================
   START REAL MODE
   ========================================================= */

const startLiveButton =
  $("#startLiveTrades");

if (startLiveButton) {
  startLiveButton.onclick =
    () => {
      if (
        !isRealAccount()
      ) {
        setText(
          "#liveTradeStatus",
          "LIVE trading: REAL ACCOUNT REQUIRED"
        );

        return;
      }

      if (
        connectedAccountMode !==
        "REAL"
      ) {
        setText(
          "#liveTradeStatus",
          "LIVE trading: CONNECT THE SELECTED REAL ACCOUNT FIRST"
        );

        return;
      }

      if (
        !ws ||
        ws.readyState !==
          WebSocket.OPEN
      ) {
        setText(
          "#liveTradeStatus",
          "LIVE trading: CONNECT FEED FIRST"
        );

        return;
      }

      if (
        !allLiveConfirmationsAccepted()
      ) {
        setText(
          "#liveTradeStatus",
          "LIVE trading: ACCEPT ALL REQUIRED RISK AND TERMS CONFIRMATIONS"
        );

        return;
      }

      const limits =
        liveLimitsValid();

      if (!limits.ok) {
        setText(
          "#liveTradeStatus",
          "LIVE trading: " +
          limits.reason
        );

        return;
      }

      liveSignals = 0;

      realTrades = 0;
      realWins = 0;
      realLosses = 0;
      realSessionPL = 0;

      liveProposalPending =
        false;

      realPurchasePending =
        false;

      latestLiveProposalId =
        null;

      latestLiveProposalAsk =
        null;

      latestLiveProposalPayout =
        null;

      latestLiveDirection =
        null;

      latestLiveStake =
        null;

      latestLiveDuration =
        null;

      clearRealOrderPreview();

      lastSignal =
        "WAIT";

      liveArmed =
        true;

      setDisabled(
        "#startLiveTrades",
        true
      );

      setDisabled(
        "#stopLiveTrades",
        false
      );

      setText(
        "#liveTradeStatus",
        realExecutionEnabled
          ? "LIVE mode ARMED • REAL ACCOUNT • each order requires manual confirmation"
          : "LIVE signal mode ARMED • REAL ACCOUNT • PREVIEW ONLY • server execution locked"
      );

      updateLiveDisplay();
    };
}


/* =========================================================
   STOP REAL MODE
   ========================================================= */

const stopLiveButton =
  $("#stopLiveTrades");

if (stopLiveButton) {
  stopLiveButton.onclick =
    () =>
      stopLive(
        activeRealContractId
          ? "STOPPED • open contract will continue to settlement"
          : "LOCKED"
      );
}


/* =========================================================
   SETTINGS CHANGE = REAL LOCK
   ========================================================= */

[
  "#liveMaxStake",
  "#liveMaxTrades",
  "#liveMaxLoss",
  "#stake",
  "#duration"
].forEach(selector => {
  const el =
    $(selector);

  if (!el) return;

  el.addEventListener(
    "change",
    () => {
      bankroll();

      if (
        liveArmed ||
        realOrderAwaitingConfirmation
      ) {
        stopLive(
          "LOCKED • settings changed"
        );
      }
    }
  );
});


/* =========================================================
   INITIAL STATE
   ========================================================= */

setDisabled(
  "#stopDemoTrades",
  true
);

setDisabled(
  "#startLiveTrades",
  true
);

setDisabled(
  "#stopLiveTrades",
  true
);

setDisabled(
  "#executeRealTrade",
  true
);

clearRealOrderPreview();

loadPaperState();

scoreboard();
bankroll();
displayStrategy();

updateDemoDisplay();
updateLiveDisplay();

refreshAccountUI();
updateRealExecutionStatus();

init();
