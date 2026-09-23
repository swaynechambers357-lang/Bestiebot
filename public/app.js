const $=s=>document.querySelector(s);
const prices=[];
let tests=0,wins=0,losses=0,pendingTest=null,lastSignal="WAIT";
let startingCapital=20,currentCapital=20;
let actualDemoPL=0;
let activeContractId=null;
const ema=(values,period)=>{if(values.length<period)return null;const k=2/(period+1);let e=values[0];for(let i=1;i<values.length;i++)e=values[i]*k+e*(1-k);return e;};
const rsi=(v,p=14)=>{if(v.length<p+1)return null;let g=0,l=0;for(let i=v.length-p;i<v.length;i++){const d=v[i]-v[i-1];if(d>0)g+=d;else l-=d;}if(l===0)return 100;const rs=(g/p)/(l/p);return 100-(100/(1+rs));};
const signal=()=>{const e5=ema(prices,5),e13=ema(prices,13),r=rsi(prices);if(e5==null||e13==null||r==null)return "WAIT";if(e5>e13&&r>50&&r<70)return "RISE";if(e5<e13&&r<50&&r>30)return "FALL";return "WAIT";};
const updateScoreboard=()=>{$("#tests").textContent=tests;$("#record").textContent=wins+" / "+losses;$("#accuracy").textContent=tests?Math.round(wins/tests*100)+"%":"—";};
const updateBankroll=()=>{const stake=Math.max(0,Number($("#stake").value)||0);$("#currentCapital").textContent="$"+currentCapital.toFixed(2);const pl=currentCapital-startingCapital;$("#sessionPL").textContent=(pl>=0?"+$":"-$")+Math.abs(pl).toFixed(2);$("#bankrollStatus").textContent=currentCapital>=stake&&stake>0?"READY":"CAN'T FUND NEXT TRADE";
$("#actualPL").textContent=(actualDemoPL>=0?"+$":"-$")+Math.abs(actualDemoPL).toFixed(2);};
const validateSignal=price=>{if(pendingTest){pendingTest.ticksLeft--;if(pendingTest.ticksLeft===0){const won=pendingTest.direction==="RISE"?price>pendingTest.entry:price<pendingTest.entry;tests++;const stake=Math.max(0,Number($("#stake").value)||0);
if(won){wins++;currentCapital+=stake;}else{losses++;currentCapital=Math.max(0,currentCapital-stake);}
updateBankroll();pendingTest=null;updateScoreboard();}}const s=signal();if(!pendingTest&&(s==="RISE"||s==="FALL")&&s!==lastSignal&&Number($("#stake").value)>0&&currentCapital>=Number($("#stake").value)){pendingTest={direction:s,entry:price,ticksLeft:Math.max(1,parseInt($("#duration").value,10)||5)};}lastSignal=s;};
async function get(url,opts){const r=await fetch(url,opts);const j=await r.json();if(!r.ok)throw new Error(j.error||"Request failed");return j;}
const feedUrl=x=>x?.data?.url||null;
const feedSocket=x=>feedUrl(x);
const socketUrl=x=>feedUrl(x);
const demoOnly=()=>String($("#account").selectedOptions[0]?.textContent||"").includes("Demo");
async function init(){
  const s=await get("/api/session");
  $("#login").style.display=s.authenticated?"none":"block";
  $("#logout").style.display=s.authenticated?"block":"none";
  $("#status").textContent=s.authenticated?"Signed in securely. Loading accounts…":"Not connected";
  if(!s.authenticated)return;
  try{
    const a=await get("/api/accounts");
    const list=a.data || a.accounts || [];
    const arr=Array.isArray(list)?list:(Array.isArray(list.accounts)?list.accounts:[]);
    $("#account").innerHTML="";
    for(const x of arr){
      const id=x.account_id||x.id||x.loginid;
      const demo=(x.account_type||x.type||"").toLowerCase().includes("demo") || String(id||"").startsWith("VRTC");
      if(id && demo){ const o=document.createElement("option");o.value=id;o.textContent=`Demo • ${id}`;$("#account").append(o); }
    }
    if(!$("#account").options.length){const o=document.createElement("option");o.textContent="No demo account detected";$("#account").append(o);}
    $("#status").textContent="Connected. Demo-only setup.";
  }catch(e){$("#status").textContent=e.message;}
}
$("#login").onclick=()=>location.href="/auth/login";
$("#logout").onclick=async()=>{await get("/api/logout",{method:"POST"});location.reload()};
$("#connect").disabled=false;
let ws=null,reconnectTimer=null,manualFeed=false;
const connectFeed=async()=>{try{clearTimeout(reconnectTimer);$("#status").textContent="Connecting to R_50…";const id=$("#account").value;const o=await get("/api/otp/"+encodeURIComponent(id),{method:"POST"});ws=new WebSocket(o.data.url);ws.onopen=()=>{
  ws.send(JSON.stringify({ticks:"R_50",subscribe:1}));
  ws.send(JSON.stringify({contracts_for:"R_50"}));
  $("#status").textContent="R_50 feed connected ✓";
};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.contracts_for){
  console.log("R_50 contracts:",m.contracts_for);
  $("#status").textContent="R_50 contracts received ✓";
};if(m.tick){const price=Number(m.tick.quote);prices.push(price);if(prices.length>200)prices.shift();validateSignal(price);$("#status").textContent="R_50 • "+price+" • Memory "+prices.length;}};ws.onerror=()=>{try{ws.close();}catch(e){}};ws.onclose=()=>{if(manualFeed){$("#status").textContent="Feed disconnected • reconnecting…";clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connectFeed,3000);}};}catch(e){$("#status").textContent="Feed error: "+e.message;if(manualFeed){clearTimeout(reconnectTimer);reconnectTimer=setTimeout(connectFeed,3000);}}};$("#connect").onclick=()=>{if(manualFeed)return;manualFeed=true;connectFeed();};
$("#capital").onchange=()=>{const v=Number($("#capital").value);if(!Number.isFinite(v)||v<=0){$("#capital").value=startingCapital.toFixed(2);return;}startingCapital=v;currentCapital=v;tests=0;wins=0;losses=0;pendingTest=null;lastSignal="WAIT";updateScoreboard();updateBankroll();};
setInterval(()=>{const s=signal();if(s)$("#signal").textContent=s;},1000);
init().catch(e=>$("#status").textContent=e.message);
