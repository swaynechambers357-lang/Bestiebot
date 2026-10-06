const $ = s => document.querySelector(s);

/* =========================================================
   BESTIE BOT V2
   Strategy B: EMA20 / EMA50 + RSI14
   Market: R_50

   DEMO:
   - Automatic proposal
   - Automatic DEMO purchase
   - Contract monitoring

   REAL:
   - Real-account connection
   - Strategy signals
   - Real-account proposal preview
   - NO automatic real-money purchase
   ========================================================= */

const prices = [];
let tests = 0, wins = 0, losses = 0;
let pendingTest = null, lastSignal = "WAIT";
let startingCapital = 20, currentCapital = 20;
let cooldown = 0;

let ws = null, reconnectTimer = null, manualFeed = false;
let connectedAccountId = null, connectedAccountMode = null;

const accountInfo = new Map();

function selectedAccountInfo() {
  const account = $("#account");
  if (!account) return null;
  return accountInfo.get(account.value) || null;
}
function selectedMode() { return selectedAccountInfo()?.mode || null; }
function isDemoAccount() { return selectedMode() === "DEMO"; }
function isRealAccount() { return selectedMode() === "REAL"; }

let actualDemoPL = 0;
let demoTradeEnabled = false, demoTradePending = false;
let activeDemoContractId = null, activeDemoSubscriptionId = null;
let pendingDemoDirection = null;
let demoTrades = 0, demoWins = 0, demoLosses = 0;
const MAX_DEMO_TRADES = 20;

let liveArmed = false, liveProposalPending = false;
let liveTrades = 0, liveWins = 0, liveLosses = 0, livePL = 0;
let latestLiveProposalId = null, latestLiveProposalAsk = null;
let latestLiveProposalPayout = null, latestLiveDirection = null;

const REQ = {
  SAFE_PROPOSAL: 501,
  DEMO_PROPOSAL: 601,
  DEMO_BUY: 602,
  DEMO_MONITOR: 603,
  LIVE_PROPOSAL: 701
};

function setText(selector, text) {
  const el = $(selector);
  if (el) el.textContent = text;
}
function setDisabled(selector, value) {
  const el = $(selector);
  if (el) el.disabled = value;
}
function numberValue(selector, fallback = 0) {
  const el = $(selector);
  if (!el) return fallback;
  const n = Number(el.value);
  return Number.isFinite(n) ? n : fallback;
}
function integerValue(selector, fallback = 1) {
  const el = $(selector);
  if (!el) return fallback;
  const n = parseInt(el.value, 10);
  return Number.isFinite(n) ? n : fallback;
}
function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? "$" + n.toFixed(2) : "$0.00";
}

function savePaperState() {
  try {
    localStorage.setItem("bestiePaperState", JSON.stringify({
      tests, wins, losses, startingCapital, currentCapital
    }));
  } catch (e) {
    console.log("Paper memory could not be saved", e);
  }
}
function loadPaperState() {
  try {
    const raw = localStorage.getItem("bestiePaperState");
    if (!raw) return;
    const saved = JSON.parse(raw);
    tests = Number(saved.tests) || 0;
    wins = Number(saved.wins) || 0;
    losses = Number(saved.losses) || 0;
    startingCapital = Number(saved.startingCapital) || 20;
    currentCapital = Number(saved.currentCapital);
    if (!Number.isFinite(currentCapital)) currentCapital = startingCapital;
  } catch (e) {
    console.log("Paper memory could not be loaded", e);
  }
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let result = values[0];
  for (let i = 1; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }
  return result;
}
function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0, lossesValue = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const difference = values[i] - values[i - 1];
    if (difference > 0) gains += difference;
    else lossesValue -= difference;
  }
  if (lossesValue === 0) return gains === 0 ? 50 : 100;
  const rs = (gains / period) / (lossesValue / period);
  return 100 - (100 / (1 + rs));
}

function strategy() {
  const e20 = ema(prices, 20), e50 = ema(prices, 50), r = rsi(prices, 14);
  if (e20 === null || e50 === null || r === null || prices.length < 50) {
    return {trend:"WAITING", pullback:"WAITING", confirmation:"WAITING", signal:"WAIT", e20, e50, r};
  }
  const price = prices[prices.length - 1];
  const prev = prices[prices.length - 2];
  let trend = "FLAT";
  if (e20 > e50) trend = "BULLISH";
  if (e20 < e50) trend = "BEARISH";
  const gap = Math.abs(e20 - e50);
  const minZone = Math.max(Math.abs(price) * 0.00005, 0.00001);
  const zone = Math.max(gap * 0.35, minZone);
  let pullback = "NO";
  if (trend === "BULLISH" && Math.abs(price - e20) <= zone) pullback = "BULLISH SETUP";
  if (trend === "BEARISH" && Math.abs(price - e20) <= zone) pullback = "BEARISH SETUP";
  let confirmation = "WAITING", signal = "WAIT";
  if (pullback === "BULLISH SETUP") {
    if (r > 50 && r < 70 && price > prev) { confirmation = "CONFIRMED ↑"; signal = "RISE"; }
    else confirmation = "WAITING ↑";
  }
  if (pullback === "BEARISH SETUP") {
    if (r < 50 && r > 30 && price < prev) { confirmation = "CONFIRMED ↓"; signal = "FALL"; }
    else confirmation = "WAITING ↓";
  }
  return {trend, pullback, confirmation, signal, e20, e50, r};
}

function displayStrategy() {
  const s = strategy();
  setText("#trend", s.trend);
  setText("#ema20", s.e20 === null ? "—" : s.e20.toFixed(5));
  setText("#ema50", s.e50 === null ? "—" : s.e50.toFixed(5));
  setText("#rsiValue", s.r === null ? "—" : s.r.toFixed(1));
  setText("#pullback", s.pullback);
  setText("#confirmation", s.confirmation);
  setText("#signal", s.signal);
}
function scoreboard() {
  setText("#tests", tests);
  setText("#record", wins + " / " + losses);
  setText("#accuracy", tests ? Math.round(wins / tests * 100) + "%" : "—");
}
function bankroll() {
  const stake = Math.max(0, numberValue("#stake", 0));
  setText("#currentCapital", money(currentCapital));
  const paperPL = currentCapital - startingCapital;
  setText("#sessionPL", (paperPL >= 0 ? "+$" : "-$") + Math.abs(paperPL).toFixed(2));
  setText("#actualPL", (actualDemoPL >= 0 ? "+$" : "-$") + Math.abs(actualDemoPL).toFixed(2));
  setText("#bankrollStatus", stake > 0 && currentCapital >= stake ? "READY" : "CAN'T FUND NEXT TEST");
}
function updateDemoDisplay() {
  setText("#demoTradeStatus", demoTradeEnabled
    ? `Actual demo trading: ARMED • ${demoTrades} / ${MAX_DEMO_TRADES} • ${demoWins}W / ${demoLosses}L`
    : (activeDemoContractId ? "Actual demo trading: STOPPING • current contract will settle" : "Actual demo trading: LOCKED"));
}

function liveMaxStake() { return Math.max(0, numberValue("#liveMaxStake", 1)); }
function liveMaxTrades() { return Math.max(1, integerValue("#liveMaxTrades", 5)); }
function liveMaxLoss() { return Math.max(0, numberValue("#liveMaxLoss", 5)); }

function updateLiveDisplay() {
  setText("#liveTrades", liveTrades);
  setText("#liveRecord", liveWins + " / " + liveLosses);
  setText("#livePL", (livePL >= 0 ? "+$" : "-$") + Math.abs(livePL).toFixed(2));
  setText("#liveSafety", liveArmed ? "ARMED • PROPOSAL ONLY" : "LOCKED");
}
function liveLimitsValid() {
  const stake = numberValue("#stake", 0);
  const maxStake = liveMaxStake();
  const maxTrades = liveMaxTrades();
  const maxLoss = liveMaxLoss();
  if (!Number.isFinite(stake) || stake <= 0) return {ok:false, reason:"INVALID STAKE"};
  if (!Number.isFinite(maxStake) || maxStake <= 0) return {ok:false, reason:"INVALID MAXIMUM STAKE"};
  if (stake > maxStake) return {ok:false, reason:"STAKE EXCEEDS LIVE MAXIMUM"};
  if (!Number.isFinite(maxTrades) || maxTrades < 1) return {ok:false, reason:"INVALID TRADE LIMIT"};
  if (!Number.isFinite(maxLoss) || maxLoss <= 0) return {ok:false, reason:"INVALID LOSS LIMIT"};
  return {ok:true};
}
function stopLive(reason = "LOCKED") {
  liveArmed = false;
  liveProposalPending = false;
  latestLiveProposalId = null;
  latestLiveProposalAsk = null;
  latestLiveProposalPayout = null;
  latestLiveDirection = null;
  setDisabled("#stopLiveTrades", true);
  refreshAccountUI();
  setText("#liveTradeStatus", "LIVE trading: " + reason);
  updateLiveDisplay();
}

async function get(url, opts) {
  const response = await fetch(url, opts);
  let data;
  try { data = await response.json(); }
  catch (e) { throw new Error("Invalid server response"); }
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function detectAccountMode(account) {
  const id = String(account.account_id || account.id || account.loginid || "");
  const type = String(account.account_type || account.type || "").toLowerCase();
  if (type.includes("demo") || type.includes("virtual") || id.startsWith("VRTC")) return "DEMO";
  return "REAL";
}
function refreshAccountUI() {
  const mode = selectedMode();
  const confirm = Boolean($("#liveConfirm")?.checked);
  setText("#accountMode", mode || "NOT CONNECTED");
  setText("#modeBadge", mode || "SAFE");
  if (mode === "DEMO") {
    setDisabled("#startDemoTrades", false);
    setDisabled("#startLiveTrades", true);
  } else if (mode === "REAL") {
    setDisabled("#startDemoTrades", true);
    setDisabled("#startLiveTrades", !confirm || liveArmed);
  } else {
    setDisabled("#startDemoTrades", true);
    setDisabled("#startLiveTrades", true);
  }
}

function requestDemoProposal(direction) {
  if (!demoTradeEnabled) return false;
  if (!isDemoAccount()) {
    demoTradeEnabled = false;
    setText("#demoTradeStatus", "Actual demo trading: DEMO ACCOUNT REQUIRED");
    return false;
  }
  if (demoTrades >= MAX_DEMO_TRADES) { finishDemoSession(); return false; }
  if (!ws || ws.readyState !== WebSocket.OPEN || demoTradePending || activeDemoContractId) return false;
  const contractType = direction === "RISE" ? "CALL" : direction === "FALL" ? "PUT" : null;
  if (!contractType) return false;
  const stake = Math.max(0, numberValue("#stake", 0));
  const duration = Math.max(1, integerValue("#duration", 10));
  if (stake <= 0) { setText("#demoTradeStatus", "Actual demo trading: INVALID STAKE"); return false; }
  demoTradePending = true;
  pendingDemoDirection = direction;
  ws.send(JSON.stringify({
    proposal:1, amount:stake, basis:"stake", contract_type:contractType,
    currency:"USD", duration, duration_unit:"t", underlying_symbol:"R_50",
    req_id:REQ.DEMO_PROPOSAL
  }));
  return true;
}

function buyDemoProposal(proposalId, askPrice) {
  if (!demoTradeEnabled || !isDemoAccount()) {
    demoTradePending = false; pendingDemoDirection = null; return false;
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    demoTradePending = false; pendingDemoDirection = null; return false;
  }
  if (!proposalId || !demoTradePending || activeDemoContractId) return false;
  const price = Number(askPrice);
  if (!Number.isFinite(price) || price <= 0) {
    demoTradePending = false; pendingDemoDirection = null; return false;
  }
  ws.send(JSON.stringify({buy:String(proposalId), price, req_id:REQ.DEMO_BUY}));
  return true;
}

function requestLiveProposal(direction) {
  if (!liveArmed) return false;
  if (!isRealAccount()) { stopLive("REAL ACCOUNT REQUIRED"); return false; }
  if (!ws || ws.readyState !== WebSocket.OPEN || liveProposalPending) return false;
  const limits = liveLimitsValid();
  if (!limits.ok) { stopLive(limits.reason); return false; }
  const contractType = direction === "RISE" ? "CALL" : direction === "FALL" ? "PUT" : null;
  if (!contractType) return false;
  const stake = numberValue("#stake", 0);
  const duration = Math.max(1, integerValue("#duration", 10));
  liveProposalPending = true;
  latestLiveDirection = direction;
  ws.send(JSON.stringify({
    proposal:1, amount:stake, basis:"stake", contract_type:contractType,
    currency:"USD", duration, duration_unit:"t", underlying_symbol:"R_50",
    req_id:REQ.LIVE_PROPOSAL
  }));
  setText("#liveTradeStatus", "LIVE: requesting " + direction + " proposal…");
  return true;
}

function finishDemoSession() {
  demoTradeEnabled = false; demoTradePending = false;
  setDisabled("#startDemoTrades", false);
  setDisabled("#stopDemoTrades", true);
  setText("#demoTradeStatus",
    `Actual demo trading: TEST COMPLETE • ${demoTrades} / ${MAX_DEMO_TRADES} • ${demoWins}W / ${demoLosses}L`);
}

function testSignal(price) {
  if (pendingTest) {
    pendingTest.left--;
    if (pendingTest.left <= 0) {
      const won = pendingTest.direction === "RISE" ? price > pendingTest.entry : price < pendingTest.entry;
      const stake = Math.max(0, numberValue("#stake", 0));
      tests++;
      if (won) { wins++; currentCapital += stake; }
      else { losses++; currentCapital = Math.max(0, currentCapital - stake); }
      pendingTest = null; cooldown = 5;
      scoreboard(); bankroll(); savePaperState();
    }
    return;
  }
  if (cooldown > 0) { cooldown--; return; }
  const s = strategy().signal;
  const stake = Math.max(0, numberValue("#stake", 0));
  const duration = Math.max(1, integerValue("#duration", 10));
  if ((s === "RISE" || s === "FALL") && s !== lastSignal) {
    if (stake > 0 && currentCapital >= stake) {
      pendingTest = {direction:s, entry:price, left:duration};
    }
    if (demoTradeEnabled && isDemoAccount()) {
      const sent = requestDemoProposal(s);
      setText("#demoTradeStatus", sent
        ? "Actual demo trading: PROPOSAL SENT • " + s
        : "Actual demo trading: SIGNAL SEEN BUT PROPOSAL BLOCKED • " + s);
    }
    if (liveArmed && isRealAccount()) requestLiveProposal(s);
  }
  lastSignal = s;
}

async function init() {
  try {
    const session = await get("/api/session");
    const login = $("#login"), logout = $("#logout");
    if (login) login.style.display = session.authenticated ? "none" : "block";
    if (logout) logout.style.display = session.authenticated ? "block" : "none";
    if (!session.authenticated) {
      setText("#status", "Not connected"); refreshAccountUI(); return;
    }
    setText("#status", "Signed in securely. Loading accounts…");
    const accountsResponse = await get("/api/accounts");
    const raw = accountsResponse.data || accountsResponse.accounts || [];
    const arr = Array.isArray(raw) ? raw : (Array.isArray(raw.accounts) ? raw.accounts : []);
    const account = $("#account");
    if (!account) throw new Error("Account selector missing");
    account.innerHTML = ""; accountInfo.clear();
    for (const x of arr) {
      const id = x.account_id || x.id || x.loginid;
      if (!id) continue;
      const mode = detectAccountMode(x);
      accountInfo.set(String(id), {id:String(id), mode, raw:x});
      const option = document.createElement("option");
      option.value = String(id);
      option.textContent = mode + " • " + id;
      account.append(option);
    }
    if (!account.options.length) {
      const option = document.createElement("option");
      option.value = ""; option.textContent = "No trading account detected"; account.append(option);
    }
    setDisabled("#connect", !account.value);
    refreshAccountUI();
    setText("#status", "Connected. Select account and connect R_50 feed.");
  } catch (e) {
    setText("#status", "INIT ERROR: " + e.message);
  }
}

const loginButton = $("#login");
if (loginButton) loginButton.onclick = () => { location.href = "/auth/login"; };
const logoutButton = $("#logout");
if (logoutButton) logoutButton.onclick = async () => {
  try { await get("/api/logout", {method:"POST"}); } finally { location.reload(); }
};

const accountSelect = $("#account");
if (accountSelect) {
  accountSelect.onchange = () => {
    demoTradeEnabled = false; demoTradePending = false;
    liveArmed = false; liveProposalPending = false;
    latestLiveProposalId = null; latestLiveProposalAsk = null;
    latestLiveProposalPayout = null; latestLiveDirection = null;
    manualFeed = false;
    clearTimeout(reconnectTimer);
    if (ws) { try { ws.close(); } catch (e) {} }
    ws = null; connectedAccountId = null; connectedAccountMode = null;
    prices.length = 0; pendingTest = null; lastSignal = "WAIT"; cooldown = 0;
    setDisabled("#connect", !accountSelect.value);
    setDisabled("#stopDemoTrades", true);
    setDisabled("#stopLiveTrades", true);
    setText("#demoTradeStatus", "Actual demo trading: LOCKED");
    setText("#liveTradeStatus", "LIVE trading: LOCKED");
    setText("#status", "Account changed • connect R_50 feed");
    refreshAccountUI(); updateLiveDisplay();
  };
}

const liveConfirm = $("#liveConfirm");
if (liveConfirm) {
  liveConfirm.onchange = () => {
    if (!liveConfirm.checked && liveArmed) stopLive("LOCKED • confirmation removed");
    refreshAccountUI();
  };
}

const connectButton = $("#connect");
if (connectButton) {
  connectButton.onclick = () => {
    if (manualFeed) return;
    if (!$("#account")?.value) { setText("#status", "Select an account first"); return; }
    manualFeed = true; setDisabled("#connect", true); connectFeed();
  };
}

async function connectFeed() {
  if (!manualFeed) return;
  const account = $("#account");
  if (!account || !account.value) {
    manualFeed = false; setText("#status", "Account required"); return;
  }
  try {
    clearTimeout(reconnectTimer);
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try { ws.close(); } catch (e) {}
    }
    const id = account.value;
    const info = accountInfo.get(id);
    if (!info) throw new Error("Unknown account");
    connectedAccountId = id; connectedAccountMode = info.mode;
    setText("#status", "Connecting " + info.mode + " account to R_50…");
    const otp = await get("/api/otp/" + encodeURIComponent(id), {method:"POST"});
    if (!otp || !otp.data || !otp.data.url) throw new Error("No WebSocket URL received");
    ws = new WebSocket(otp.data.url);

    ws.onopen = () => {
      ws.send(JSON.stringify({ticks:"R_50", subscribe:1}));
      ws.send(JSON.stringify({contracts_for:"R_50"}));
      const duration = Math.max(1, integerValue("#duration", 10));
      ws.send(JSON.stringify({
        proposal:1, amount:1, basis:"stake", contract_type:"CALL",
        currency:"USD", duration, duration_unit:"t", underlying_symbol:"R_50",
        req_id:REQ.SAFE_PROPOSAL
      }));
      if (activeDemoContractId) {
        ws.send(JSON.stringify({
          proposal_open_contract:1, contract_id:activeDemoContractId,
          subscribe:1, req_id:REQ.DEMO_MONITOR
        }));
      }
      setText("#status", "R_50 feed connected ✓ • " + connectedAccountMode);
    };

    ws.onmessage = event => {
      let m;
      try { m = JSON.parse(event.data); } catch (e) { return; }

      if (m.req_id === REQ.DEMO_PROPOSAL) {
        if (m.error) {
          demoTradePending = false; pendingDemoDirection = null;
          setText("#demoTradeStatus", "Actual demo trading: PROPOSAL ERROR • " + (m.error.message || "Unknown"));
          return;
        }
        if (m.proposal) {
          const proposalId = m.proposal.id;
          const askPrice = Number(m.proposal.ask_price);
          if (!demoTradeEnabled || !isDemoAccount()) {
            demoTradePending = false; pendingDemoDirection = null; return;
          }
          buyDemoProposal(proposalId, askPrice); return;
        }
      }

      if (m.req_id === REQ.DEMO_BUY) {
        if (m.error) {
          demoTradePending = false; pendingDemoDirection = null; activeDemoContractId = null;
          setText("#demoTradeStatus", "Actual demo trading: BUY ERROR • " + (m.error.message || "Unknown"));
          return;
        }
        if (m.buy && m.buy.contract_id) {
          activeDemoContractId = m.buy.contract_id; demoTradePending = false;
          ws.send(JSON.stringify({
            proposal_open_contract:1, contract_id:activeDemoContractId,
            subscribe:1, req_id:REQ.DEMO_MONITOR
          }));
          setText("#demoTradeStatus", "Actual demo trading: CONTRACT OPEN • " + (pendingDemoDirection || "UNKNOWN"));
          return;
        }
      }

      if (m.req_id === REQ.DEMO_MONITOR && m.proposal_open_contract) {
        const contract = m.proposal_open_contract;
        if (Number(contract.contract_id) !== Number(activeDemoContractId)) return;
        if (m.subscription && m.subscription.id) activeDemoSubscriptionId = m.subscription.id;
        if (contract.is_sold) {
          const profit = Number(contract.profit) || 0;
          actualDemoPL += profit; demoTrades++;
          if (profit > 0) demoWins++; else if (profit < 0) demoLosses++;
          activeDemoContractId = null; pendingDemoDirection = null; demoTradePending = false;
          if (activeDemoSubscriptionId && ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({forget:activeDemoSubscriptionId})); } catch (e) {}
          }
          activeDemoSubscriptionId = null; bankroll();
          if (demoTrades >= MAX_DEMO_TRADES) { finishDemoSession(); return; }
          setText("#demoTradeStatus",
            `Actual demo trading: SETTLED • ${profit >= 0 ? "+$" : "-$"}${Math.abs(profit).toFixed(2)} • ${demoTrades} / ${MAX_DEMO_TRADES} • ${demoWins}W / ${demoLosses}L`);
          return;
        }
      }

      if (m.req_id === REQ.LIVE_PROPOSAL) {
        liveProposalPending = false;
        if (m.error) {
          latestLiveProposalId = null; latestLiveProposalAsk = null; latestLiveProposalPayout = null;
          setText("#liveTradeStatus", "LIVE proposal error • " + (m.error.message || "Unknown"));
          return;
        }
        if (m.proposal) {
          latestLiveProposalId = m.proposal.id || null;
          latestLiveProposalAsk = Number(m.proposal.ask_price);
          latestLiveProposalPayout = Number(m.proposal.payout);
          const askText = Number.isFinite(latestLiveProposalAsk) ? money(latestLiveProposalAsk) : "—";
          const payoutText = Number.isFinite(latestLiveProposalPayout) ? money(latestLiveProposalPayout) : "—";
          setText("#liveTradeStatus",
            `LIVE TRADE READY • ${latestLiveDirection} • Ask ${askText} • Payout ${payoutText} • MANUAL PURCHASE REQUIRED`);
          return;
        }
      }

      if (m.req_id === REQ.SAFE_PROPOSAL) {
        if (m.proposal) {
          setText("#proposalCheck", "Ask: $" + m.proposal.ask_price + " • Payout: $" + m.proposal.payout + " ✓");
        }
        if (m.error) {
          setText("#proposalCheck", "ERROR");
          setText("#status", "PROPOSAL ERROR: " + (m.error.message || "Unknown"));
        }
      }

      if (m.contracts_for) {
        const available = m.contracts_for.available || [];
        const call = available.some(x => x.contract_type === "CALL");
        const put = available.some(x => x.contract_type === "PUT");
        setText("#contractCheck", call && put ? "RISE → CALL ✓ • FALL → PUT ✓" : "CHECK CONTRACT MAPPING");
      }

      if (m.tick) {
        const price = Number(m.tick.quote);
        if (!Number.isFinite(price)) return;
        prices.push(price);
        if (prices.length > 500) prices.shift();
        testSignal(price); displayStrategy();
        setText("#status", `R_50 • ${price} • Memory ${prices.length} • ${connectedAccountMode || "UNKNOWN"}`);
      }
    };

    ws.onerror = () => { try { ws.close(); } catch (e) {} };

    ws.onclose = () => {
      demoTradePending = false; liveProposalPending = false;
      latestLiveProposalId = null; latestLiveProposalAsk = null; latestLiveProposalPayout = null;
      if (!activeDemoContractId) pendingDemoDirection = null;
      if (liveArmed) stopLive("LOCKED • connection interrupted");
      if (manualFeed) {
        setText("#status", "Feed disconnected • reconnecting…");
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectFeed, 3000);
      }
    };
  } catch (e) {
    setText("#status", "Feed error: " + e.message);
    if (liveArmed) stopLive("LOCKED • connection error");
    if (manualFeed) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectFeed, 3000);
    }
  }
}

const capitalInput = $("#capital");
if (capitalInput) {
  capitalInput.onchange = () => {
    const value = Number(capitalInput.value);
    if (!Number.isFinite(value) || value <= 0) {
      capitalInput.value = startingCapital.toFixed(2); return;
    }
    startingCapital = value; currentCapital = value;
    tests = 0; wins = 0; losses = 0;
    pendingTest = null; lastSignal = "WAIT"; cooldown = 0;
    scoreboard(); bankroll(); savePaperState();
  };
}

const startDemoButton = $("#startDemoTrades");
if (startDemoButton) {
  startDemoButton.onclick = () => {
    if (!isDemoAccount()) {
      setText("#demoTradeStatus", "Actual demo trading: DEMO ACCOUNT REQUIRED"); return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setText("#demoTradeStatus", "Actual demo trading: CONNECT FEED FIRST"); return;
    }
    if (demoTradePending || activeDemoContractId) {
      setText("#demoTradeStatus", "Actual demo trading: CONTRACT ALREADY ACTIVE"); return;
    }
    const stake = Math.max(0, numberValue("#stake", 0));
    if (stake <= 0) {
      setText("#demoTradeStatus", "Actual demo trading: ENTER A VALID STAKE"); return;
    }
    demoTrades = 0; demoWins = 0; demoLosses = 0; actualDemoPL = 0;
    demoTradePending = false; activeDemoContractId = null;
    activeDemoSubscriptionId = null; pendingDemoDirection = null;
    lastSignal = "WAIT"; demoTradeEnabled = true;
    setDisabled("#startDemoTrades", true); setDisabled("#stopDemoTrades", false);
    setText("#demoTradeStatus", "Actual demo trading: ARMED • 0 / " + MAX_DEMO_TRADES);
    bankroll();
  };
}

const stopDemoButton = $("#stopDemoTrades");
if (stopDemoButton) {
  stopDemoButton.onclick = () => {
    demoTradeEnabled = false;
    if (!activeDemoContractId) { demoTradePending = false; pendingDemoDirection = null; }
    setDisabled("#startDemoTrades", false); setDisabled("#stopDemoTrades", true);
    setText("#demoTradeStatus", activeDemoContractId
      ? "Actual demo trading: STOPPING • current contract will settle"
      : "Actual demo trading: LOCKED");
  };
}

const startLiveButton = $("#startLiveTrades");
if (startLiveButton) {
  startLiveButton.onclick = () => {
    if (!isRealAccount()) { setText("#liveTradeStatus", "LIVE trading: REAL ACCOUNT REQUIRED"); return; }
    if (!ws || ws.readyState !== WebSocket.OPEN) { setText("#liveTradeStatus", "LIVE trading: CONNECT FEED FIRST"); return; }
    if (!$("#liveConfirm")?.checked) { setText("#liveTradeStatus", "LIVE trading: CONFIRM REAL-MONEY WARNING FIRST"); return; }
    const limits = liveLimitsValid();
    if (!limits.ok) { setText("#liveTradeStatus", "LIVE trading: " + limits.reason); return; }
    liveTrades = 0; liveWins = 0; liveLosses = 0; livePL = 0;
    liveProposalPending = false; latestLiveProposalId = null;
    latestLiveProposalAsk = null; latestLiveProposalPayout = null; latestLiveDirection = null;
    lastSignal = "WAIT"; liveArmed = true;
    setDisabled("#startLiveTrades", true); setDisabled("#stopLiveTrades", false);
    setText("#liveTradeStatus", "LIVE signal mode ARMED • REAL ACCOUNT • proposals only");
    updateLiveDisplay();
  };
}

const stopLiveButton = $("#stopLiveTrades");
if (stopLiveButton) stopLiveButton.onclick = () => stopLive("LOCKED");

["#liveMaxStake", "#liveMaxTrades", "#liveMaxLoss", "#stake", "#duration"].forEach(selector => {
  const el = $(selector);
  if (!el) return;
  el.addEventListener("change", () => {
    if (liveArmed) stopLive("LOCKED • settings changed");
  });
});

setDisabled("#stopDemoTrades", true);
setDisabled("#startLiveTrades", true);
setDisabled("#stopLiveTrades", true);

loadPaperState();
scoreboard();
bankroll();
displayStrategy();
updateDemoDisplay();
updateLiveDisplay();
refreshAccountUI();
init();
