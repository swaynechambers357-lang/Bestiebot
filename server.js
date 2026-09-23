import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { URL, URLSearchParams } from "node:url";

const PORT = process.env.PORT || 10000;
const CLIENT_ID = process.env.DERIV_CLIENT_ID || "";
const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");
const sessions = new Map();

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map(x => {
    const i=x.indexOf("="); return [x.slice(0,i).trim(), decodeURIComponent(x.slice(i+1))];
  }));
}
function sid(req,res) {
  let s=cookies(req).bb_session;
  if (!s || !sessions.has(s)) {
    s=crypto.randomBytes(24).toString("hex"); sessions.set(s,{});
    res.setHeader("Set-Cookie",`bb_session=${s}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`);
  }
  return s;
}
function b64url(buf){ return Buffer.from(buf).toString("base64url"); }
function send(res,status,body,type="text/plain"){res.writeHead(status,{"Content-Type":type,"Cache-Control":"no-store"});res.end(body);}
function json(res,status,obj){send(res,status,JSON.stringify(obj),"application/json");}
function redirect(res,url){res.writeHead(302,{Location:url});res.end();}

const server=http.createServer(async (req,res)=>{
  try{
    const u=new URL(req.url, BASE_URL || `http://${req.headers.host}`);
    const s=sid(req,res), session=sessions.get(s);

    if(u.pathname==="/auth/login"){
      if(!CLIENT_ID || !BASE_URL) return send(res,500,"Server is missing DERIV_CLIENT_ID or BASE_URL.");
      const verifier=b64url(crypto.randomBytes(48));
      const challenge=b64url(crypto.createHash("sha256").update(verifier).digest());
      const state=b64url(crypto.randomBytes(24));
      session.verifier=verifier; session.state=state;
      const q=new URLSearchParams({
        response_type:"code", client_id:CLIENT_ID, redirect_uri:`${BASE_URL}/callback`,
        scope:"trade", state, code_challenge:challenge, code_challenge_method:"S256"
      });
      return redirect(res,`https://auth.deriv.com/oauth2/auth?${q}`);
    }

    if(u.pathname==="/callback"){
      if(u.searchParams.get("error")) return send(res,400,"Deriv login was cancelled or failed.");
      if(!session.state || u.searchParams.get("state")!==session.state) return send(res,400,"Security check failed (state mismatch).");
      const code=u.searchParams.get("code");
      if(!code || !session.verifier) return send(res,400,"Missing authorization code.");
      const body=new URLSearchParams({
        grant_type:"authorization_code", client_id:CLIENT_ID, code,
        code_verifier:session.verifier, redirect_uri:`${BASE_URL}/callback`
      });
      const r=await fetch("https://auth.deriv.com/oauth2/token",{
        method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body
      });
      const data=await r.json();
      delete session.verifier; delete session.state;
      if(!r.ok || !data.access_token) return json(res,r.status||500,{error:"Token exchange failed",detail:data});
      session.token=data.access_token; session.expires=Date.now()+((data.expires_in||3600)*1000);
      return redirect(res,"/");
    }

    if(u.pathname==="/api/session"){
      return json(res,200,{authenticated:!!session.token && (!session.expires || session.expires>Date.now())});
    }

    if(u.pathname==="/api/accounts"){
      if(!session.token) return json(res,401,{error:"Not signed in"});
      const r=await fetch("https://api.derivws.com/trading/v1/options/accounts",{headers:{Authorization:`Bearer ${session.token}`}});
      return json(res,r.status,await r.json());
    }

    if(u.pathname.startsWith("/api/otp/") && req.method==="POST"){
      if(!session.token) return json(res,401,{error:"Not signed in"});
      const accountId=decodeURIComponent(u.pathname.slice("/api/otp/".length));
      const r=await fetch(`https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,{
        method:"POST",headers:{Authorization:`Bearer ${session.token}`}
      });
      return json(res,r.status,await r.json());
    }

    if(u.pathname==="/api/logout" && req.method==="POST"){
      sessions.delete(s); return json(res,200,{ok:true});
    }

    const file = u.pathname==="/" ? "index.html" : u.pathname.slice(1);
    if(!["index.html","app.js","style.css"].includes(file)) return send(res,404,"Not found");
    const p=path.join(process.cwd(),"public",file);
    const type=file.endsWith(".html")?"text/html":file.endsWith(".js")?"text/javascript":"text/css";
    return send(res,200,fs.readFileSync(p),type);
  }catch(e){ return json(res,500,{error:"Server error",detail:String(e.message||e)}); }
});
server.listen(PORT,()=>console.log(`Bestie Bot listening on ${PORT}`));
