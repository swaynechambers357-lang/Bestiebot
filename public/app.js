const $=s=>document.querySelector(s);

const prices=[];
let tests=0,wins=0,losses=0,pendingTest=null,lastSignal="WAIT";
let startingCapital=20,currentCapital=20,actualDemoPL=0;
let cooldown=0,ws=null,reconnectTimer=null,manualFeed=false;

/* ===== INDICATORS ===== */
/* ===== PAPER TEST MEMORY ===== */

function savePaperState(){
  localStorage.setItem("bestiePaperState", JSON.stringify({
    tests,
    wins,
    losses,
    startingCapital,
    currentCapital
  }));
}

function loadPaperState(){
  try{
    const saved=JSON.parse(localStorage.getItem("bestiePaperState"));
    if(!saved)return;

    tests=Number(saved.tests)||0;
    wins=Number(saved.wins)||0;
    losses=Number(saved.losses)||0;
    startingCapital=Number(saved.startingCapital)||20;
    currentCapital=Number(saved.currentCapital)||startingCapital;
  }catch(e){
    console.log("Paper memory could not be loaded",e);
  }
}

function ema(v,p){
  if(v.length<p)return null;
  const k=2/(p+1);
  let e=v[0];
  for(let i=1;i<v.length;i++)e=v[i]*k+e*(1-k);
  return e;
}

function rsi(v,p=14){
  if(v.length<p+1)return null;
  let g=0,l=0;
  for(let i=v.length-p;i<v.length;i++){
    const d=v[i]-v[i-1];
    if(d>0)g+=d;
    else l-=d;
  }
  if(l===0)return g===0?50:100;
  const rs=(g/p)/(l/p);
  return 100-(100/(1+rs));
}

/* ===== STRATEGY B ===== */

function strategy(){
  const e20=ema(prices,20);
  const e50=ema(prices,50);
  const r=rsi(prices,14);

  if(e20===null||e50===null||r===null||prices.length<50){
    return {
      trend:"WAITING",
      pullback:"WAITING",
      confirmation:"WAITING",
      signal:"WAIT",
      e20,e50,r
    };
  }

  const price=prices[prices.length-1];
  const prev=prices[prices.length-2];

  let trend="FLAT";
  if(e20>e50)trend="BULLISH";
  if(e20<e50)trend="BEARISH";

  const gap=Math.abs(e20-e50);
  const minZone=Math.max(Math.abs(price)*0.00005,0.00001);
  const zone=Math.max(gap*0.35,minZone);

  let pullback="NO";
  if(trend==="BULLISH"&&Math.abs(price-e20)<=zone)
    pullback="BULLISH SETUP";

  if(trend==="BEARISH"&&Math.abs(price-e20)<=zone)
    pullback="BEARISH SETUP";

  let confirmation="WAITING";
  let signal="WAIT";

  if(pullback==="BULLISH SETUP"){
    if(r>50&&r<70&&price>prev){
      confirmation="CONFIRMED ↑";
      signal="RISE";
    }else{
      confirmation="WAITING ↑";
    }
  }

  if(pullback==="BEARISH SETUP"){
    if(r<50&&r>30&&price<prev){
      confirmation="CONFIRMED ↓";
      signal="FALL";
    }else{
      confirmation="WAITING ↓";
    }
  }

  return {trend,pullback,confirmation,signal,e20,e50,r};
}

function displayStrategy(){
  const s=strategy();
  $("#trend").textContent=s.trend;
  $("#ema20").textContent=s.e20===null?"—":s.e20.toFixed(5);
  $("#ema50").textContent=s.e50===null?"—":s.e50.toFixed(5);
  $("#rsiValue").textContent=s.r===null?"—":s.r.toFixed(1);
  $("#pullback").textContent=s.pullback;
  $("#confirmation").textContent=s.confirmation;
  $("#signal").textContent=s.signal;
}

/* ===== PAPER RESULTS ===== */

function scoreboard(){
  $("#tests").textContent=tests;
  $("#record").textContent=wins+" / "+losses;
  $("#accuracy").textContent=tests?Math.round(wins/tests*100)+"%":"—";
}

function bankroll(){
  const stake=Math.max(0,Number($("#stake").value)||0);

  $("#currentCapital").textContent="$"+currentCapital.toFixed(2);

  const pl=currentCapital-startingCapital;
  $("#sessionPL").textContent=
    (pl>=0?"+$":"-$")+Math.abs(pl).toFixed(2);

  $("#actualPL").textContent=
    (actualDemoPL>=0?"+$":"-$")+Math.abs(actualDemoPL).toFixed(2);

  $("#bankrollStatus").textContent=
    stake>0&&currentCapital>=stake?"READY":"CAN'T FUND NEXT TEST";
}

function testSignal(price){
  if(pendingTest){
    pendingTest.left--;

    if(pendingTest.left<=0){
      const won=pendingTest.direction==="RISE"
        ?price>pendingTest.entry
        :price<pendingTest.entry;

      const stake=Math.max(0,Number($("#stake").value)||0);

      tests++;

      if(won){
        wins++;
        currentCapital+=stake;
      }else{
        losses++;
        currentCapital=Math.max(0,currentCapital-stake);
      }

      pendingTest=null;
      cooldown=5;
      scoreboard();
      bankroll();
      savePaperState();
    }
    return;
  }

  if(cooldown>0){
    cooldown--;
    return;
  }

  const s=strategy().signal;
  const stake=Math.max(0,Number($("#stake").value)||0);
  const duration=Math.max(1,parseInt($("#duration").value,10)||10);

  if(
    (s==="RISE"||s==="FALL") &&
    s!==lastSignal &&
    stake>0 &&
    currentCapital>=stake
  ){
    pendingTest={
      direction:s,
      entry:price,
      left:duration
    };
  }

  lastSignal=s;
}

/* ===== API ===== */

async function get(url,opts){
  const r=await fetch(url,opts);
  const j=await r.json();
  if(!r.ok)throw new Error(j.error||"Request failed");
  return j;
}

function demoOnly(){
  const o=$("#account").selectedOptions[0];
  if(!o)return false;

  return String(o.textContent||"").startsWith("Demo • ") &&
         String(o.value||"").length>0;
}

/* ===== LOGIN ===== */

async function init(){
  try{
    const s=await get("/api/session");

    $("#login").style.display=s.authenticated?"none":"block";
    $("#logout").style.display=s.authenticated?"block":"none";

    if(!s.authenticated){
      $("#status").textContent="Not connected";
      return;
    }

    $("#status").textContent="Signed in securely. Loading accounts…";

    const a=await get("/api/accounts");
    const raw=a.data||a.accounts||[];
    const arr=Array.isArray(raw)
      ?raw
      :(Array.isArray(raw.accounts)?raw.accounts:[]);

    $("#account").innerHTML="";

    for(const x of arr){
      const id=x.account_id||x.id||x.loginid;
      const type=String(x.account_type||x.type||"").toLowerCase();
      const demo=type.includes("demo")||String(id||"").startsWith("VRTC");

      if(id&&demo){
        const o=document.createElement("option");
        o.value=id;
        o.textContent="Demo • "+id;
        $("#account").append(o);
      }
    }

    if(!$("#account").options.length){
      const o=document.createElement("option");
      o.textContent="No demo account detected";
      $("#account").append(o);
    }

    $("#status").textContent="Connected. Demo-only setup.";

  }catch(e){
    $("#status").textContent="INIT ERROR: "+e.message;
  }
}

/* ===== BUTTONS ===== */

$("#login").onclick=()=>location.href="/auth/login";

$("#logout").onclick=async()=>{
  await get("/api/logout",{method:"POST"});
  location.reload();
};

$("#connect").disabled=false;

/* ===== R_50 FEED ===== */

async function connectFeed(){
  if(!demoOnly()){
    $("#status").textContent="DEMO ACCOUNT REQUIRED • Feed blocked";
    manualFeed=false;
    return;
  }

  try{
    clearTimeout(reconnectTimer);

    $("#status").textContent="Connecting to R_50…";

    const id=$("#account").value;
    const o=await get(
      "/api/otp/"+encodeURIComponent(id),
      {method:"POST"}
    );

    ws=new WebSocket(o.data.url);

    ws.onopen=()=>{
      ws.send(JSON.stringify({
        ticks:"R_50",
        subscribe:1
      }));

      ws.send(JSON.stringify({
        contracts_for:"R_50"
      }));

      const duration=Math.max(
        1,
        parseInt($("#duration").value,10)||10
      );

      ws.send(JSON.stringify({
        proposal:1,
        amount:1,
        basis:"stake",
        contract_type:"CALL",
        currency:"USD",
        duration:duration,
        duration_unit:"t",
        underlying_symbol:"R_50",
        req_id:501
      }));

      $("#status").textContent="R_50 feed connected ✓";
    };

    ws.onmessage=e=>{
      const m=JSON.parse(e.data);

      if(m.req_id===501){
        if(m.proposal){
          window.latestProposalId=m.proposal.id;

          $("#proposalCheck").textContent=
            "Ask: $"+m.proposal.ask_price+
            " • Payout: $"+m.proposal.payout+" ✓";
        }

        if(m.error){
          $("#proposalCheck").textContent="ERROR";
          $("#status").textContent=
            "PROPOSAL ERROR: "+(m.error.message||"Unknown");
        }
      }

      if(m.contracts_for){
        const available=m.contracts_for.available||[];

        const call=available.some(x=>x.contract_type==="CALL");
        const put=available.some(x=>x.contract_type==="PUT");

        $("#contractCheck").textContent=
          call&&put
            ?"RISE → CALL ✓ • FALL → PUT ✓"
            :"CHECK CONTRACT MAPPING";
      }

      if(m.tick){
        const price=Number(m.tick.quote);
        if(!Number.isFinite(price))return;

        prices.push(price);
        if(prices.length>500)prices.shift();

        testSignal(price);
        displayStrategy();

        $("#status").textContent=
          "R_50 • "+price+" • Memory "+prices.length;
      }
    };

    ws.onerror=()=>{
      try{ws.close();}catch(e){}
    };

    ws.onclose=()=>{
      if(manualFeed){
        $("#status").textContent="Feed disconnected • reconnecting…";
        clearTimeout(reconnectTimer);
        reconnectTimer=setTimeout(connectFeed,3000);
      }
    };

  }catch(e){
    $("#status").textContent="Feed error: "+e.message;

    if(manualFeed){
      clearTimeout(reconnectTimer);
      reconnectTimer=setTimeout(connectFeed,3000);
    }
  }
}

$("#connect").onclick=()=>{
  if(manualFeed)return;
  manualFeed=true;
  connectFeed();
};

/* ===== CAPITAL RESET ===== */

$("#capital").onchange=()=>{
  const v=Number($("#capital").value);

  if(!Number.isFinite(v)||v<=0){
    $("#capital").value=startingCapital.toFixed(2);
    return;
  }

  startingCapital=v;
  currentCapital=v;

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

/* ===== START ===== */
loadPaperState();
scoreboard();
bankroll();
displayStrategy();

init();
