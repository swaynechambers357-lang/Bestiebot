
const $=s=>document.querySelector(s);

/* =========================================================
BESTIE BOT
Strategy B: EMA20 / EMA50 + RSI14
R_50
PAPER TESTING + CONTROLLED DERIV DEMO TESTING
========================================================= */

/* ===== MARKET / PAPER STATE ===== */

const prices=[];

let tests=0;
let wins=0;
let losses=0;

let pendingTest=null;
let lastSignal="WAIT";

let startingCapital=20;
let currentCapital=20;

let cooldown=0;

let ws=null;
let reconnectTimer=null;
let manualFeed=false;

/* ===== ACTUAL DEMO TRADING ===== */

let actualDemoPL=0;

let demoTradeEnabled=false;
let demoTradePending=false;

let activeDemoContractId=null;
let activeDemoSubscriptionId=null;

let pendingDemoDirection=null;

let demoTrades=0;
let demoWins=0;
let demoLosses=0;

const MAX_DEMO_TRADES=20;

/* ===== SAFE UI HELPERS ===== */

function setText(selector,text){
const el=$(selector);
if(el)el.textContent=text;
}

function setDisabled(selector,value){
const el=$(selector);
if(el)el.disabled=value;
}

function numberValue(selector,fallback=0){
const el=$(selector);
if(!el)return fallback;

const n=Number(el.value);

return Number.isFinite(n)
?n
:fallback;
}

function integerValue(selector,fallback=1){
const el=$(selector);
if(!el)return fallback;

const n=parseInt(el.value,10);

return Number.isFinite(n)
?n
:fallback;
}

/* ===== PAPER TEST MEMORY ===== */

function savePaperState(){
try{
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
}catch(e){
console.log("Paper memory could not be saved",e);
}
}

function loadPaperState(){
try{
const raw=localStorage.getItem("bestiePaperState");

if(!raw)return;

const saved=JSON.parse(raw);

tests=Number(saved.tests)||0;
wins=Number(saved.wins)||0;
losses=Number(saved.losses)||0;

startingCapital=
  Number(saved.startingCapital)||20;

currentCapital=
  Number(saved.currentCapital);

if(!Number.isFinite(currentCapital)){
  currentCapital=startingCapital;
}

}catch(e){
console.log(
"Paper memory could not be loaded",
e
);
}
}

/* ===== INDICATORS ===== */

function ema(values,period){
if(values.length<period)return null;

const k=2/(period+1);

/*
Preserve the indicator behavior used during
the existing Strategy B paper test.
*/
let result=values[0];

for(let i=1;i<values.length;i++){
  result=
    values[i]*k+
    result*(1-k);
}

return result;
}

function rsi(values,period=14){
if(values.length<period+1)return null;

let gains=0;
let lossesValue=0;

for(
let i=values.length-period;
i<values.length;
i++
){
const difference=
values[i]-values[i-1];

if(difference>0){
  gains+=difference;
}else{
  lossesValue-=difference;
}

}

if(lossesValue===0){
return gains===0
?50
:100;
}

const rs=
(gains/period)/
(lossesValue/period);

return 100-(100/(1+rs));
}

/* ===== STRATEGY B ===== */

function strategy(){
const e20=ema(prices,20);
const e50=ema(prices,50);
const r=rsi(prices,14);

if(
e20===null ||
e50===null ||
r===null ||
prices.length<50
){
return {
trend:"WAITING",
pullback:"WAITING",
confirmation:"WAITING",
signal:"WAIT",
e20,
e50,
r
};
}

const price=
prices[prices.length-1];

const prev=
prices[prices.length-2];

let trend="FLAT";

if(e20>e50){
trend="BULLISH";
}

if(e20<e50){
trend="BEARISH";
}

const gap=
Math.abs(e20-e50);

const minZone=
Math.max(
Math.abs(price)*0.00005,
0.00001
);

const zone=
Math.max(
gap*0.35,
minZone
);

let pullback="NO";

if(
trend==="BULLISH" &&
Math.abs(price-e20)<=zone
){
pullback="BULLISH SETUP";
}

if(
trend==="BEARISH" &&
Math.abs(price-e20)<=zone
){
pullback="BEARISH SETUP";
}

let confirmation="WAITING";
let signal="WAIT";

if(pullback==="BULLISH SETUP"){
if(
r>50 &&
r<70 &&
price>prev
){
confirmation="CONFIRMED ↑";
signal="RISE";
}else{
confirmation="WAITING ↑";
}
}

if(pullback==="BEARISH SETUP"){
if(
r<50 &&
r>30 &&
price<prev
){
confirmation="CONFIRMED ↓";
signal="FALL";
}else{
confirmation="WAITING ↓";
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

/* ===== STRATEGY DISPLAY ===== */

function displayStrategy(){
const s=strategy();

setText(
"#trend",
s.trend
);

setText(
"#ema20",
s.e20===null
?"—"
:s.e20.toFixed(5)
);

setText(
"#ema50",
s.e50===null
?"—"
:s.e50.toFixed(5)
);

setText(
"#rsiValue",
s.r===null
?"—"
:s.r.toFixed(1)
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
}

/* ===== PAPER SCOREBOARD ===== */

function scoreboard(){
setText(
"#tests",
tests
);

setText(
"#record",
wins+" / "+losses
);

setText(
"#accuracy",
tests
?Math.round(
wins/tests*100
)+"%"
:"—"
);
}

/* ===== BANKROLL DISPLAY ===== */

function bankroll(){
const stake=
Math.max(
0,
numberValue("#stake",0)
);

setText(
"#currentCapital",
"$"+currentCapital.toFixed(2)
);

const paperPL=
currentCapital-startingCapital;

setText(
"#sessionPL",
(paperPL>=0?"+$":"-$")+
Math.abs(paperPL).toFixed(2)
);

setText(
"#actualPL",
(actualDemoPL>=0?"+$":"-$")+
Math.abs(actualDemoPL).toFixed(2)
);

setText(
"#bankrollStatus",
stake>0 &&
currentCapital>=stake
?"READY"
:"CAN'T FUND NEXT TEST"
);
}

/* ===== DEMO DISPLAY ===== */

function updateDemoDisplay(){
setText(
"#demoTradeStatus",
demoTradeEnabled
?(
"Actual demo trading: ARMED • "+
demoTrades+
" / "+
MAX_DEMO_TRADES+
" • "+
demoWins+
"W / "+
demoLosses+
"L"
)
:(
activeDemoContractId
?"Actual demo trading: STOPPING • current contract will settle"
:"Actual demo trading: LOCKED"
)
);
}

/* ===== API ===== */

async function get(url,opts){
const response=
await fetch(url,opts);

let data;

try{
data=await response.json();
}catch(e){
throw new Error(
"Invalid server response"
);
}

if(!response.ok){
throw new Error(
data.error||
"Request failed"
);
}

return data;
}

/* ===== DEMO ACCOUNT GUARD ===== */

function demoOnly(){
const account=$("#account");

if(!account)return false;

const option=
account.selectedOptions[0];

if(!option)return false;

const name=
String(
option.textContent||""
);

const id=
String(
option.value||""
);

return (
name.startsWith("Demo • ") &&
id.length>0
);
}

/* ===== DEMO PROPOSAL ===== */

function requestDemoProposal(direction){
if(!demoTradeEnabled){
return false;
}

if(
demoTrades>=MAX_DEMO_TRADES
){
finishDemoSession();
return false;
}

if(!demoOnly()){
demoTradeEnabled=false;

setText(
  "#demoTradeStatus",
  "Actual demo trading: DEMO ACCOUNT REQUIRED"
);

return false;

}

if(
!ws ||
ws.readyState!==WebSocket.OPEN
){
return false;
}

if(
demoTradePending ||
activeDemoContractId
){
return false;
}

const contractType=
direction==="RISE"
?"CALL"
:direction==="FALL"
?"PUT"
:null;

if(!contractType){
return false;
}

const stake=
Math.max(
0,
numberValue("#stake",0)
);

const duration=
Math.max(
1,
integerValue("#duration",10)
);

if(stake<=0){
setText(
"#demoTradeStatus",
"Actual demo trading: INVALID STAKE"
);

return false;

}

demoTradePending=true;
pendingDemoDirection=direction;

ws.send(
JSON.stringify({
proposal:1,
amount:stake,
basis:"stake",
contract_type:contractType,
currency:"USD",
duration:duration,
duration_unit:"t",
underlying_symbol:"R_50",
req_id:601
})
);

return true;
}

/* ===== BUY DEMO PROPOSAL ===== */

function buyDemoProposal(
proposalId,
askPrice
){
if(!demoTradeEnabled){
demoTradePending=false;
pendingDemoDirection=null;
return false;
}

if(!demoOnly()){
demoTradePending=false;
pendingDemoDirection=null;
return false;
}

if(
!ws ||
ws.readyState!==WebSocket.OPEN
){
demoTradePending=false;
pendingDemoDirection=null;
return false;
}

if(
!proposalId ||
!demoTradePending ||
activeDemoContractId
){
return false;
}

const price=
Number(askPrice);

if(
!Number.isFinite(price) ||
price<=0
){
demoTradePending=false;
pendingDemoDirection=null;
return false;
}

ws.send(
JSON.stringify({
buy:String(proposalId),
price:price,
req_id:602
})
);

return true;
}

/* ===== FINISH DEMO SESSION ===== */

function finishDemoSession(){
demoTradeEnabled=false;
demoTradePending=false;

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
"Actual demo trading: TEST COMPLETE • "+
demoTrades+
" / "+
MAX_DEMO_TRADES+
" • "+
demoWins+
"W / "+
demoLosses+
"L"
);
}

/* ===== PAPER + SIGNAL ENGINE ===== */

function testSignal(price){

/*
Complete an existing paper contract first.
*/

if(pendingTest){
pendingTest.left--;

if(pendingTest.left<=0){

  const won=
    pendingTest.direction==="RISE"
      ?price>pendingTest.entry
      :price<pendingTest.entry;

  const stake=
    Math.max(
      0,
      numberValue("#stake",0)
    );

  tests++;

  if(won){
    wins++;
    currentCapital+=stake;
  }else{
    losses++;
    currentCapital=
      Math.max(
        0,
        currentCapital-stake
      );
  }

  pendingTest=null;

  cooldown=5;

  scoreboard();
  bankroll();
  savePaperState();
}

return;

}

/*
Cooldown after a paper contract.
*/

if(cooldown>0){
cooldown--;
return;
}

const s=
strategy().signal;

const stake=
Math.max(
0,
numberValue("#stake",0)
);

const duration=
Math.max(
1,
integerValue("#duration",10)
);

/*
A new signal only fires once.
*/

if(
(s==="RISE" || s==="FALL") &&
s!==lastSignal
){

/*
  Paper engine.
*/

if(
  stake>0 &&
  currentCapital>=stake
){
  pendingTest={
    direction:s,
    entry:price,
    left:duration
  };
}


/*
  Actual DERIV DEMO engine.
  Completely blocked unless the user
  has manually armed demo trading.
*/

if(demoTradeEnabled){

  const sent=
    requestDemoProposal(s);

  setText(
    "#demoTradeStatus",
    sent
      ?(
        "Actual demo trading: PROPOSAL SENT • "+
        s
      )
      :(
        "Actual demo trading: SIGNAL SEEN BUT PROPOSAL BLOCKED • "+
        s
      )
  );
}

}

lastSignal=s;
}

/* ===== LOGIN ===== */

async function init(){
try{
const session=
await get("/api/session");

const login=$("#login");
const logout=$("#logout");

if(login){
  login.style.display=
    session.authenticated
      ?"none"
      :"block";
}

if(logout){
  logout.style.display=
    session.authenticated
      ?"block"
      :"none";
}

if(!session.authenticated){
  setText(
    "#status",
    "Not connected"
  );
  return;
}

setText(
  "#status",
  "Signed in securely. Loading accounts…"
);

const accountsResponse=
  await get("/api/accounts");

const raw=
  accountsResponse.data||
  accountsResponse.accounts||
  [];

const arr=
  Array.isArray(raw)
    ?raw
    :(
      Array.isArray(raw.accounts)
        ?raw.accounts
        :[]
    );

const account=$("#account");

if(!account){
  throw new Error(
    "Account selector missing"
  );
}

account.innerHTML="";

for(const x of arr){

  const id=
    x.account_id||
    x.id||
    x.loginid;

  const type=
    String(
      x.account_type||
      x.type||
      ""
    ).toLowerCase();

  const demo=
    type.includes("demo") ||
    String(id||"").startsWith("VRTC");

  if(id && demo){
    const option=
      document.createElement("option");

    option.value=id;
    option.textContent=
      "Demo • "+id;

    account.append(option);
  }
}

if(!account.options.length){
  const option=
    document.createElement("option");

  option.value="";
  option.textContent=
    "No demo account detected";

  account.append(option);
}

setText(
  "#status",
  "Connected. Demo-only setup."
);

}catch(e){
setText(
"#status",
"INIT ERROR: "+e.message
);
}
}

/* ===== LOGIN BUTTONS ===== */

const loginButton=$("#login");

if(loginButton){
loginButton.onclick=()=>{
location.href="/auth/login";
};
}

const logoutButton=$("#logout");

if(logoutButton){
logoutButton.onclick=async()=>{
try{
await get(
"/api/logout",
{method:"POST"}
);
}finally{
location.reload();
}
};
}

/* ===== CONNECT BUTTON ===== */

const connectButton=$("#connect");

if(connectButton){
connectButton.disabled=false;
}

/* ===== R_50 FEED ===== */

async function connectFeed(){

if(!manualFeed){
return;
}

if(!demoOnly()){
setText(
"#status",
"DEMO ACCOUNT REQUIRED • Feed blocked"
);

manualFeed=false;
return;

}

try{
clearTimeout(reconnectTimer);

/*
  Close a stale socket before opening
  another one.
*/

if(
  ws &&
  (
    ws.readyState===WebSocket.OPEN ||
    ws.readyState===WebSocket.CONNECTING
  )
){
  try{
    ws.close();
  }catch(e){}
}

setText(
  "#status",
  "Connecting to R_50…"
);

const id=
  $("#account").value;

const otp=
  await get(
    "/api/otp/"+
    encodeURIComponent(id),
    {method:"POST"}
  );

if(
  !otp ||
  !otp.data ||
  !otp.data.url
){
  throw new Error(
    "No WebSocket URL received"
  );
}

ws=
  new WebSocket(
    otp.data.url
  );


/* ===== SOCKET OPEN ===== */

ws.onopen=()=>{

  ws.send(
    JSON.stringify({
      ticks:"R_50",
      subscribe:1
    })
  );

  ws.send(
    JSON.stringify({
      contracts_for:"R_50"
    })
  );

  const duration=
    Math.max(
      1,
      integerValue("#duration",10)
    );

  /*
    Safe proposal verification.
    This does NOT purchase anything.
  */

  ws.send(
    JSON.stringify({
      proposal:1,
      amount:1,
      basis:"stake",
      contract_type:"CALL",
      currency:"USD",
      duration:duration,
      duration_unit:"t",
      underlying_symbol:"R_50",
      req_id:501
    })
  );

  setText(
    "#status",
    "R_50 feed connected ✓"
  );
};


/* ===== SOCKET MESSAGE ===== */

ws.onmessage=event=>{

  let m;

  try{
    m=JSON.parse(event.data);
  }catch(e){
    return;
  }


  /* =========================================
     ACTUAL DEMO PROPOSAL
     ========================================= */

  if(m.req_id===601){

    if(m.error){

      demoTradePending=false;
      pendingDemoDirection=null;

      setText(
        "#demoTradeStatus",
        "Actual demo trading: PROPOSAL ERROR • "+
        (m.error.message||"Unknown")
      );

      return;
    }

    if(m.proposal){

      const proposalId=
        m.proposal.id;

      const askPrice=
        m.proposal.ask_price;

      if(!demoTradeEnabled){

        demoTradePending=false;
        pendingDemoDirection=null;

        return;
      }

      buyDemoProposal(
        proposalId,
        askPrice
      );

      return;
    }
  }


  /* =========================================
     ACTUAL DEMO BUY
     ========================================= */

  if(m.req_id===602){

    if(m.error){

      demoTradePending=false;
      pendingDemoDirection=null;
      activeDemoContractId=null;

      setText(
        "#demoTradeStatus",
        "Actual demo trading: BUY ERROR • "+
        (m.error.message||"Unknown")
      );

      return;
    }

    if(
      m.buy &&
      m.buy.contract_id
    ){

      activeDemoContractId=
        m.buy.contract_id;

      demoTradePending=false;

      ws.send(
        JSON.stringify({
          proposal_open_contract:1,
          contract_id:
            activeDemoContractId,
          subscribe:1,
          req_id:603
        })
      );

      setText(
        "#demoTradeStatus",
        "Actual demo trading: CONTRACT OPEN • "+
        (
          pendingDemoDirection||
          "UNKNOWN"
        )
      );

      return;
    }
  }


  /* =========================================
     ACTUAL DEMO CONTRACT MONITOR
     ========================================= */

  if(
    m.req_id===603 &&
    m.proposal_open_contract
  ){

    const contract=
      m.proposal_open_contract;

    if(
      Number(contract.contract_id)!==
      Number(activeDemoContractId)
    ){
      return;
    }

    if(m.subscription?.id){
      activeDemoSubscriptionId=
        m.subscription.id;
    }

    if(contract.is_sold){

      const profit=
        Number(contract.profit)||0;

      actualDemoPL+=profit;
      demoTrades++;

      if(profit>0){
        demoWins++;
      }else if(profit<0){
        demoLosses++;
      }

      /*
        Forget the finished contract.
      */

      activeDemoContractId=null;
      pendingDemoDirection=null;
      demoTradePending=false;


      /*
        Forget the finished contract
        subscription if Deriv supplied
        a subscription ID.
      */

      if(
        activeDemoSubscriptionId &&
        ws &&
        ws.readyState===WebSocket.OPEN
      ){
        try{
          ws.send(
            JSON.stringify({
              forget:
                activeDemoSubscriptionId
            })
          );
        }catch(e){}
      }

      activeDemoSubscriptionId=null;

      bankroll();

      if(
        demoTrades>=MAX_DEMO_TRADES
      ){
        finishDemoSession();
        return;
      }

      setText(
        "#demoTradeStatus",
        "Actual demo trading: SETTLED • "+
        (
          profit>=0
            ?"+$"
            :"-$"
        )+
        Math.abs(profit).toFixed(2)+
        " • "+
        demoTrades+
        " / "+
        MAX_DEMO_TRADES+
        " • "+
        demoWins+
        "W / "+
        demoLosses+
        "L"
      );

      return;
    }
  }


  /* =========================================
     SAFE PROPOSAL CHECK
     ========================================= */

  if(m.req_id===501){

    if(m.proposal){

      window.latestProposalId=
        m.proposal.id;

      setText(
        "#proposalCheck",
        "Ask: $"+
        m.proposal.ask_price+
        " • Payout: $"+
        m.proposal.payout+
        " ✓"
      );
    }

    if(m.error){

      setText(
        "#proposalCheck",
        "ERROR"
      );

      setText(
        "#status",
        "PROPOSAL ERROR: "+
        (
          m.error.message||
          "Unknown"
        )
      );
    }
  }


  /* =========================================
     CONTRACT AVAILABILITY
     ========================================= */

  if(m.contracts_for){

    const available=
      m.contracts_for.available||
      [];

    const call=
      available.some(
        x=>
          x.contract_type===
          "CALL"
      );

    const put=
      available.some(
        x=>
          x.contract_type===
          "PUT"
      );

    setText(
      "#contractCheck",
      call&&put
        ?"RISE → CALL ✓ • FALL → PUT ✓"
        :"CHECK CONTRACT MAPPING"
    );
  }


  /* =========================================
     LIVE R_50 TICK
     ========================================= */

  if(m.tick){

    const price=
      Number(
        m.tick.quote
      );

    if(
      !Number.isFinite(price)
    ){
      return;
    }

    prices.push(price);

    if(prices.length>500){
      prices.shift();
    }

    testSignal(price);
    displayStrategy();

    /*
      Keep the main status as the feed
      heartbeat. Demo contract information
      stays in #demoTradeStatus so it isn't
      erased by every new tick.
    */

    setText(
      "#status",
      "R_50 • "+
      price+
      " • Memory "+
      prices.length
    );
  }
};


/* ===== SOCKET ERROR ===== */

ws.onerror=()=>{
  try{
    ws.close();
  }catch(e){}
};


/* ===== SOCKET CLOSE ===== */

ws.onclose=()=>{

  /*
    A pending proposal may no longer be
    valid after the socket disappears.
  */

  demoTradePending=false;

  if(
    !activeDemoContractId
  ){
    pendingDemoDirection=null;
  }

  if(manualFeed){

    setText(
      "#status",
      "Feed disconnected • reconnecting…"
    );

    clearTimeout(
      reconnectTimer
    );

    reconnectTimer=
      setTimeout(
        connectFeed,
        3000
      );
  }
};

}catch(e){

setText(
  "#status",
  "Feed error: "+
  e.message
);

if(manualFeed){

  clearTimeout(
    reconnectTimer
  );

  reconnectTimer=
    setTimeout(
      connectFeed,
      3000
    );
}

}
}

/* ===== CONNECT FEED ===== */

if(connectButton){

connectButton.onclick=()=>{

if(manualFeed){
  return;
}

manualFeed=true;
connectFeed();

};
}

/* ===== CAPITAL RESET ===== */

const capitalInput=$("#capital");

if(capitalInput){

capitalInput.onchange=()=>{

const value=
  Number(
    capitalInput.value
  );

if(
  !Number.isFinite(value) ||
  value<=0
){
  capitalInput.value=
    startingCapital.toFixed(2);

  return;
}

startingCapital=value;
currentCapital=value;

tests=0;
wins=0;
losses=0;

pendingTest=null;
lastSignal="WAIT";
cooldown=0;

scoreboard();
bankroll();
savePaperState();

};
}

/* ===== START CONTROLLED DEMO TEST ===== */

const startDemoButton=
$("#startDemoTrades");

if(startDemoButton){

startDemoButton.onclick=()=>{

if(!demoOnly()){

  setText(
    "#demoTradeStatus",
    "Actual demo trading: DEMO ACCOUNT REQUIRED"
  );

  return;
}

if(
  !ws ||
  ws.readyState!==WebSocket.OPEN
){

  setText(
    "#demoTradeStatus",
    "Actual demo trading: CONNECT FEED FIRST"
  );

  return;
}

if(
  demoTradePending ||
  activeDemoContractId
){

  setText(
    "#demoTradeStatus",
    "Actual demo trading: CONTRACT ALREADY ACTIVE"
  );

  return;
}

const stake=
  Math.max(
    0,
    numberValue("#stake",0)
  );

if(stake<=0){

  setText(
    "#demoTradeStatus",
    "Actual demo trading: ENTER A VALID STAKE"
  );

  return;
}


/*
  Start a completely fresh controlled
  demo session.
*/

demoTrades=0;
demoWins=0;
demoLosses=0;

actualDemoPL=0;

demoTradePending=false;
activeDemoContractId=null;
activeDemoSubscriptionId=null;
pendingDemoDirection=null;

/*
  Allow the next valid Strategy B signal
  to be detected cleanly.
*/

lastSignal="WAIT";

demoTradeEnabled=true;

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
  "Actual demo trading: ARMED • 0 / "+
  MAX_DEMO_TRADES
);

bankroll();

};
}

/* ===== STOP CONTROLLED DEMO TEST ===== */

const stopDemoButton=
$("#stopDemoTrades");

if(stopDemoButton){

stopDemoButton.onclick=()=>{

demoTradeEnabled=false;

/*
  Do not attempt another purchase if
  STOP is pressed while waiting for a
  proposal.
*/

if(!activeDemoContractId){
  demoTradePending=false;
  pendingDemoDirection=null;
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
    ?"Actual demo trading: STOPPING • current contract will settle"
    :"Actual demo trading: LOCKED"
);

};
}

/* ===== INITIAL UI STATE ===== */

setDisabled(
"#stopDemoTrades",
true
);

/* ===== START APP ===== */

loadPaperState();
scoreboard();
bankroll();
displayStrategy();
updateDemoDisplay();

init();
