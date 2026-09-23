const $=s=>document.querySelector(s);
const prices=[];
const ema=(values,period)=>{if(values.length<period)return null;const k=2/(period+1);let e=values[0];for(let i=1;i<values.length;i++)e=values[i]*k+e*(1-k);return e;};
const rsi=(v,p=14)=>{if(v.length<p+1)return null;let g=0,l=0;for(let i=v.length-p;i<v.length;i++){const d=v[i]-v[i-1];if(d>0)g+=d;else l-=d;}if(l===0)return 100;const rs=(g/p)/(l/p);return 100-(100/(1+rs));};
const signal=()=>{const e5=ema(prices,5),e13=ema(prices,13),r=rsi(prices);if(e5==null||e13==null||r==null)return "WAIT";if(e5>e13&&r>50&&r<70)return "RISE";if(e5<e13&&r<50&&r>30)return "FALL";return "WAIT";};
async function get(url,opts){const r=await fetch(url,opts);const j=await r.json();if(!r.ok)throw new Error(j.error||"Request failed");return j;}
const feedUrl=x=>x?.data?.url||x?.url||x?.data?.ws_url||x?.ws_url||x?.data?.websocket_url||x?.websocket_url||null;
const feedSocket=x=>x?.data?.ws_url||x?.ws_url||x?.data?.websocket_url||x?.websocket_url||feedUrl(x);
const socketUrl=x=>feedSocket(x);
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
$("#connect").onclick=async()=>{try{$("#status").textContent="Connecting to R_50…";const id=$("#account").value;const o=await get("/api/otp/"+encodeURIComponent(id),{method:"POST"});const ws=new WebSocket(o.data.url);ws.onopen=()=>{ws.send(JSON.stringify({ticks:"R_50",subscribe:1}));$("#status").textContent="R_50 feed connected ✓";};ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.tick){const price=Number(m.tick.quote);prices.push(price);if(prices.length>200)prices.shift();$("#status").textContent="R_50 • "+price+" • Memory "+prices.length;}};ws.onerror=()=>{$("#status").textContent="WebSocket connection error";};}catch(e){$("#status").textContent="Feed error: "+e.message;}};
setInterval(()=>{const s=signal();if(s)$("#signal").textContent=s;},1000);
init().catch(e=>$("#status").textContent=e.message);
