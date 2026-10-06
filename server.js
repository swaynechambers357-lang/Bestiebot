import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { URL, URLSearchParams } from "node:url";

/* =========================================================
   BESTIE BOT SERVER
   OAuth + account discovery + account-specific Deriv OTP
   Supports DEMO and REAL accounts.
   ========================================================= */

const PORT = process.env.PORT || 10000;
const CLIENT_ID = process.env.DERIV_CLIENT_ID || "";
const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");

const sessions = new Map();

/* =========================
   SESSION HELPERS
   ========================= */

function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .filter(Boolean)
      .map(x => {
        const i = x.indexOf("=");

        return [
          x.slice(0, i).trim(),
          decodeURIComponent(x.slice(i + 1))
        ];
      })
  );
}

function sid(req, res) {
  let sessionId = cookies(req).bb_session;

  if (!sessionId || !sessions.has(sessionId)) {
    sessionId = crypto.randomBytes(24).toString("hex");

    sessions.set(sessionId, {});

    res.setHeader(
      "Set-Cookie",
      `bb_session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`
    );
  }

  return sessionId;
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function send(res, status, body, type = "text/plain") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });

  res.end(body);
}

function json(res, status, obj) {
  send(
    res,
    status,
    JSON.stringify(obj),
    "application/json"
  );
}

function redirect(res, url) {
  res.writeHead(302, {
    Location: url
  });

  res.end();
}

/* =========================
   TOKEN CHECK
   ========================= */

function sessionAuthenticated(session) {
  return Boolean(
    session &&
    session.token &&
    (
      !session.expires ||
      session.expires > Date.now()
    )
  );
}

/* =========================
   SERVER
   ========================= */

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(
      req.url,
      BASE_URL || `http://${req.headers.host}`
    );

    const sessionId = sid(req, res);
    const session = sessions.get(sessionId);

    /* =========================
       OAUTH LOGIN
       ========================= */

    if (u.pathname === "/auth/login") {
      if (!CLIENT_ID || !BASE_URL) {
        return send(
          res,
          500,
          "Server is missing DERIV_CLIENT_ID or BASE_URL."
        );
      }

      const verifier = b64url(
        crypto.randomBytes(48)
      );

      const challenge = b64url(
        crypto
          .createHash("sha256")
          .update(verifier)
          .digest()
      );

      const state = b64url(
        crypto.randomBytes(24)
      );

      session.verifier = verifier;
      session.state = state;

      const q = new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: `${BASE_URL}/callback`,
        scope: "trade",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256"
      });

      return redirect(
        res,
        `https://auth.deriv.com/oauth2/auth?${q}`
      );
    }

    /* =========================
       OAUTH CALLBACK
       ========================= */

    if (u.pathname === "/callback") {
      if (u.searchParams.get("error")) {
        return send(
          res,
          400,
          "Deriv login was cancelled or failed."
        );
      }

      if (
        !session.state ||
        u.searchParams.get("state") !== session.state
      ) {
        return send(
          res,
          400,
          "Security check failed (state mismatch)."
        );
      }

      const code = u.searchParams.get("code");

      if (!code || !session.verifier) {
        return send(
          res,
          400,
          "Missing authorization code."
        );
      }

      const body = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code,
        code_verifier: session.verifier,
        redirect_uri: `${BASE_URL}/callback`
      });

      const r = await fetch(
        "https://auth.deriv.com/oauth2/token",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded"
          },
          body
        }
      );

      const data = await r.json();

      delete session.verifier;
      delete session.state;

      if (!r.ok || !data.access_token) {
        return json(
          res,
          r.status || 500,
          {
            error: "Token exchange failed",
            detail: data
          }
        );
      }

      session.token = data.access_token;

      session.expires =
        Date.now() +
        ((data.expires_in || 3600) * 1000);

      return redirect(res, "/");
    }

    /* =========================
       SESSION STATUS
       ========================= */

    if (u.pathname === "/api/session") {
      return json(
        res,
        200,
        {
          authenticated:
            sessionAuthenticated(session)
        }
      );
    }

    /* =========================
       OPTIONS ACCOUNTS

       IMPORTANT:
       Return ALL accounts supplied by
       Deriv. The frontend will explicitly
       identify DEMO vs REAL.
       ========================= */

    if (u.pathname === "/api/accounts") {
      if (!sessionAuthenticated(session)) {
        return json(
          res,
          401,
          {
            error: "Not signed in"
          }
        );
      }

      const r = await fetch(
        "https://api.derivws.com/trading/v1/options/accounts",
        {
          headers: {
            Authorization:
              `Bearer ${session.token}`
          }
        }
      );

      const data = await r.json();

      return json(
        res,
        r.status,
        data
      );
    }

    /* =========================
       ACCOUNT-SPECIFIC OTP

       Deriv determines DEMO/REAL from
       the requested account and returns
       the corresponding authenticated
       WebSocket URL.
       ========================= */

    if (
      u.pathname.startsWith("/api/otp/") &&
      req.method === "POST"
    ) {
      if (!sessionAuthenticated(session)) {
        return json(
          res,
          401,
          {
            error: "Not signed in"
          }
        );
      }

      const accountId =
        decodeURIComponent(
          u.pathname.slice(
            "/api/otp/".length
          )
        );

      if (!accountId) {
        return json(
          res,
          400,
          {
            error: "Account ID required"
          }
        );
      }

      const r = await fetch(
        "https://api.derivws.com/trading/v1/options/accounts/" +
        encodeURIComponent(accountId) +
        "/otp",
        {
          method: "POST",
          headers: {
            Authorization:
              `Bearer ${session.token}`
          }
        }
      );

      const data = await r.json();

      return json(
        res,
        r.status,
        data
      );
    }

    /* =========================
       LOGOUT
       ========================= */

    if (
      u.pathname === "/api/logout" &&
      req.method === "POST"
    ) {
      sessions.delete(sessionId);

      return json(
        res,
        200,
        {
          ok: true
        }
      );
    }

    /* =========================
       STATIC FILES
       ========================= */

    const file =
      u.pathname === "/"
        ? "index.html"
        : u.pathname.slice(1);

    const allowedFiles = [
      "index.html",
      "app.js",
      "style.css"
    ];

    if (!allowedFiles.includes(file)) {
      return send(
        res,
        404,
        "Not found"
      );
    }

    const p = path.join(
      process.cwd(),
      "public",
      file
    );

    if (!fs.existsSync(p)) {
      return send(
        res,
        404,
        "File not found"
      );
    }

    const type =
      file.endsWith(".html")
        ? "text/html"
        : file.endsWith(".js")
          ? "text/javascript"
          : "text/css";

    return send(
      res,
      200,
      fs.readFileSync(p),
      type
    );

  } catch (e) {
    console.error(
      "Bestie Bot server error:",
      e
    );

    return json(
      res,
      500,
      {
        error: "Server error",
        detail: String(
          e.message || e
        )
      }
    );
  }
});

/* =========================
   START SERVER
   ========================= */

server.listen(
  PORT,
  () => {
    console.log(
      `Bestie Bot listening on ${PORT}`
    );
  }
);

