const $=s=>document.querySelector(s);
async function get(url,opts){const r=await fetch(url,opts);const j=await r.json();if(!r.ok)throw new Error(j.error||"Request failed");return j;}
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
$("#connect").onclick=async()=>{try{$("#status").textContent="Getting secure demo feed…";const id=$("#account").value;const o=await get("/api/otp/"+encodeURIComponent(id),{method:"POST"});console.log("OTP response",o);$("#status").textContent="Demo feed credentials received ✓";}catch(e){$("#status").textContent="Feed error: "+e.message;}};
init().catch(e=>$("#status").textContent=e.message);
