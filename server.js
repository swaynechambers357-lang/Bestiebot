import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { URL, URLSearchParams } from "node:url";

/* =========================================================
   VELØRA SERVER
   Private Trading Intelligence

   FEATURES
   ---------------------------------------------------------
   • Deriv OAuth 2.0 + PKCE
   • Secure session cookies
   • Session-ID rotation after login
   • DEMO + REAL account discovery
   • Account-specific Deriv WebSocket OTP
   • Server-side real-money master lock
   • Public capability/config endpoint
   • Logout + cookie invalidation
   • Basic security headers
   • Static application delivery

   IMPORTANT
   ---------------------------------------------------------
   REAL execution is OFF unless the server environment has:

   REAL_TRADING_ENABLED=true

   Browser JavaScript cannot override this master switch.
   ========================================================= */


/* =========================================================
   ENVIRONMENT
   ========================================================= */

const PORT =
  Number(process.env.PORT) || 10000;

const CLIENT_ID =
  String(
    process.env.DERIV_CLIENT_ID || ""
  ).trim();

const BASE_URL =
  String(
    process.env.BASE_URL || ""
  )
    .trim()
    .replace(/\/$/, "");


/* =========================================================
   REAL-MONEY MASTER LOCK
   ========================================================= */

const REAL_TRADING_ENABLED =
  String(
    process.env.REAL_TRADING_ENABLED || ""
  )
    .trim()
    .toLowerCase() === "true";


/* =========================================================
   SESSION SETTINGS
   ========================================================= */

const SESSION_COOKIE =
  "bb_session";

const SESSION_MAX_AGE_SECONDS =
  86400;

const SESSION_MAX_AGE_MS =
  SESSION_MAX_AGE_SECONDS * 1000;

const sessions =
  new Map();


/* =========================================================
   COOKIE HELPERS
   ========================================================= */

function cookies(req) {
  const header =
    req.headers.cookie || "";

  const result = {};

  for (const part of header.split(";")) {
    if (!part.trim()) {
      continue;
    }

    const index =
      part.indexOf("=");

    if (index < 0) {
      continue;
    }

    const key =
      part
        .slice(0, index)
        .trim();

    const rawValue =
      part
        .slice(index + 1)
        .trim();

    try {
      result[key] =
        decodeURIComponent(rawValue);
    } catch {
      result[key] =
        rawValue;
    }
  }

  return result;
}


function sessionCookie(sessionId) {
  return (
    `${SESSION_COOKIE}=` +
    `${encodeURIComponent(sessionId)}; ` +
    `HttpOnly; Secure; SameSite=Lax; ` +
    `Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`
  );
}


function clearSessionCookie() {
  return (
    `${SESSION_COOKIE}=; ` +
    `HttpOnly; Secure; SameSite=Lax; ` +
    `Path=/; Max-Age=0`
  );
}


/* =========================================================
   SESSION HELPERS
   ========================================================= */

function createSession() {
  const id =
    crypto
      .randomBytes(24)
      .toString("hex");

  sessions.set(
    id,
    {
      createdAt: Date.now(),
      lastSeen: Date.now()
    }
  );

  return id;
}


function getSession(req, res) {
  const parsedCookies =
    cookies(req);

  let sessionId =
    parsedCookies[
      SESSION_COOKIE
    ];

  let session =
    sessionId
      ? sessions.get(sessionId)
      : null;

  if (!session) {
    sessionId =
      createSession();

    session =
      sessions.get(sessionId);

    res.setHeader(
      "Set-Cookie",
      sessionCookie(sessionId)
    );
  }

  session.lastSeen =
    Date.now();

  return {
    sessionId,
    session
  };
}


function rotateSession(
  oldSessionId,
  newData,
  res
) {
  const newSessionId =
    crypto
      .randomBytes(24)
      .toString("hex");

  sessions.set(
    newSessionId,
    {
      createdAt: Date.now(),
      lastSeen: Date.now(),
      ...newData
    }
  );

  if (oldSessionId) {
    sessions.delete(
      oldSessionId
    );
  }

  res.setHeader(
    "Set-Cookie",
    sessionCookie(
      newSessionId
    )
  );

  return newSessionId;
}


function sessionAuthenticated(
  session
) {
  if (
    !session ||
    !session.token
  ) {
    return false;
  }

  if (
    session.expires &&
    session.expires <= Date.now()
  ) {
    return false;
  }

  return true;
}


/* =========================================================
   SESSION CLEANUP
   ========================================================= */

function cleanupSessions() {
  const now =
    Date.now();

  for (
    const [id, session]
    of sessions.entries()
  ) {
    const lastSeen =
      Number(
        session.lastSeen ||
        session.createdAt ||
        0
      );

    const tokenExpired =
      session.expires &&
      session.expires <= now;

    const inactive =
      lastSeen &&
      now - lastSeen >
        SESSION_MAX_AGE_MS;

    if (
      tokenExpired ||
      inactive
    ) {
      sessions.delete(id);
    }
  }
}


setInterval(
  cleanupSessions,
  15 * 60 * 1000
).unref();


/* =========================================================
   ENCODING
   ========================================================= */

function b64url(value) {
  return Buffer
    .from(value)
    .toString("base64url");
}


/* =========================================================
   SECURITY HEADERS
   ========================================================= */

function securityHeaders() {
  return {
    "X-Content-Type-Options":
      "nosniff",

    "X-Frame-Options":
      "DENY",

    "Referrer-Policy":
      "no-referrer",

    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=()",

    "Cross-Origin-Opener-Policy":
      "same-origin",

    "Content-Security-Policy":
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self' https: wss:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self' https://auth.deriv.com"
      ].join("; ")
  };
}


/* =========================================================
   RESPONSE HELPERS
   ========================================================= */

function send(
  res,
  status,
  body,
  type = "text/plain; charset=utf-8"
) {
  const existingCookies =
    res.getHeader(
      "Set-Cookie"
    );

  const headers = {
    ...securityHeaders(),

    "Content-Type":
      type,

    "Cache-Control":
      "no-store"
  };

  if (existingCookies) {
    headers["Set-Cookie"] =
      existingCookies;
  }

  res.writeHead(
    status,
    headers
  );

  res.end(body);
}


function json(
  res,
  status,
  obj
) {
  return send(
    res,
    status,
    JSON.stringify(obj),
    "application/json; charset=utf-8"
  );
}


function redirect(
  res,
  location
) {
  const existingCookies =
    res.getHeader(
      "Set-Cookie"
    );

  const headers = {
    ...securityHeaders(),
    Location: location,
    "Cache-Control": "no-store"
  };

  if (existingCookies) {
    headers["Set-Cookie"] =
      existingCookies;
  }

  res.writeHead(
    302,
    headers
  );

  res.end();
}


/* =========================================================
   METHOD CHECK
   ========================================================= */

function methodAllowed(
  req,
  res,
  methods
) {
  if (
    methods.includes(
      req.method
    )
  ) {
    return true;
  }

  res.setHeader(
    "Allow",
    methods.join(", ")
  );

  json(
    res,
    405,
    {
      error:
        "Method not allowed"
    }
  );

  return false;
}


/* =========================================================
   AUTH CHECK
   ========================================================= */

function requireAuthentication(
  session,
  res
) {
  if (
    sessionAuthenticated(
      session
    )
  ) {
    return true;
  }

  json(
    res,
    401,
    {
      error:
        "Not signed in"
    }
  );

  return false;
}


/* =========================================================
   FETCH JSON HELPER
   ========================================================= */

async function fetchJson(
  url,
  options = {}
) {
  const response =
    await fetch(
      url,
      options
    );

  let data;

  try {
    data =
      await response.json();
  } catch {
    data = {
      error:
        "Invalid response from upstream service"
    };
  }

  return {
    response,
    data
  };
}


/* =========================================================
   ACCOUNT MODE DETECTION
   ========================================================= */

function detectAccountMode(
  account
) {
  const id =
    String(
      account?.account_id ||
      account?.id ||
      account?.loginid ||
      ""
    );

  const type =
    String(
      account?.account_type ||
      account?.type ||
      ""
    ).toLowerCase();

  if (
    id.startsWith("VRTC") ||
    type.includes("demo") ||
    type.includes("virtual")
  ) {
    return "DEMO";
  }

  return "REAL";
}


/* =========================================================
   SERVER
   ========================================================= */

const server =
  http.createServer(
    async (
      req,
      res
    ) => {

      try {

        const u =
          new URL(
            req.url,
            BASE_URL ||
              `http://${req.headers.host}`
          );


        const {
          sessionId,
          session
        } =
          getSession(
            req,
            res
          );


        /* =================================================
           HEALTH
           ================================================= */

        if (
          u.pathname ===
          "/api/health"
        ) {
          if (
            !methodAllowed(
              req,
              res,
              ["GET"]
            )
          ) {
            return;
          }

          return json(
            res,
            200,
            {
              ok: true,
              service:
                "VELØRA"
            }
          );
        }


        /* =================================================
           PUBLIC CAPABILITIES

           Safe for the browser to read.
           No secrets or tokens are returned.
           ================================================= */

        if (
          u.pathname ===
          "/api/config"
        ) {
          if (
            !methodAllowed(
              req,
              res,
              ["GET"]
            )
          ) {
            return;
          }

          return json(
            res,
            200,
            {
              app:
                "VELØRA",

              market:
                "R_50",

              demoExecution:
                true,

              realAccountConnection:
                true,

              realProposalPreview:
                true,

              realExecutionEnabled:
                REAL_TRADING_ENABLED
            }
          );
        }


        /* =================================================
           OAUTH LOGIN
           ================================================= */

        if (
          u.pathname ===
          "/auth/login"
        ) {
          if (
            !methodAllowed(
              req,
              res,
              ["GET"]
            )
          ) {
            return;
          }

          if (
            !CLIENT_ID ||
            !BASE_URL
          ) {
            return send(
              res,
              500,
              "Server is missing DERIV_CLIENT_ID or BASE_URL."
            );
          }


          const verifier =
            b64url(
              crypto.randomBytes(
                48
              )
            );


          const challenge =
            b64url(
              crypto
                .createHash(
                  "sha256"
                )
                .update(
                  verifier
                )
                .digest()
            );


          const state =
            b64url(
              crypto.randomBytes(
                24
              )
            );


          session.verifier =
            verifier;

          session.state =
            state;

          session.oauthCreatedAt =
            Date.now();


          const query =
            new URLSearchParams({
              response_type:
                "code",

              client_id:
                CLIENT_ID,

              redirect_uri:
                `${BASE_URL}/callback`,

              scope:
                "trade",

              state,

              code_challenge:
                challenge,

              code_challenge_method:
                "S256"
            });


          return redirect(
            res,
            `https://auth.deriv.com/oauth2/auth?${query}`
          );
        }


        /* =================================================
           OAUTH CALLBACK
           ================================================= */

        if (
          u.pathname ===
          "/callback"
        ) {
          if (
            !methodAllowed(
              req,
              res,
              ["GET"]
            )
          ) {
            return;
          }


          if (
            u.searchParams.get(
              "error"
            )
          ) {
            return send(
              res,
              400,
              "Deriv login was cancelled or failed."
            );
          }


          if (
            !session.state ||
            u.searchParams.get(
              "state"
            ) !== session.state
          ) {
            return send(
              res,
              400,
              "Security check failed (state mismatch)."
            );
          }


          const code =
            u.searchParams.get(
              "code"
            );


          if (
            !code ||
            !session.verifier
          ) {
            return send(
              res,
              400,
              "Missing authorization code."
            );
          }


          const tokenBody =
            new URLSearchParams({
              grant_type:
                "authorization_code",

              client_id:
                CLIENT_ID,

              code,

              code_verifier:
                session.verifier,

              redirect_uri:
                `${BASE_URL}/callback`
            });


          const {
            response,
            data
          } =
            await fetchJson(
              "https://auth.deriv.com/oauth2/token",
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/x-www-form-urlencoded"
                },

                body:
                  tokenBody
              }
            );


          delete session.verifier;
          delete session.state;
          delete session.oauthCreatedAt;


          if (
            !response.ok ||
            !data.access_token
          ) {
            return json(
              res,
              response.status ||
                500,
              {
                error:
                  "Token exchange failed"
              }
            );
          }


          const expires =
            Date.now() +
            (
              (
                Number(
                  data.expires_in
                ) ||
                3600
              ) *
              1000
            );


          rotateSession(
            sessionId,
            {
              token:
                data.access_token,

              expires
            },
            res
          );


          return redirect(
            res,
            "/"
          );
        }


        /* =================================================
           SESSION STATUS
           ================================================= */

        if (
          u.pathname ===
          "/api/session"
        ) {
          if (
            !methodAllowed(
              req,
              res,
              ["GET"]
            )
          ) {
            return;
          }

          return json(
            res,
            200,
            {
              authenticated:
                sessionAuthenticated(
                  session
                ),

              realExecutionEnabled:
                REAL_TRADING_ENABLED
            }
          );
        }


        /* =================================================
           ACCOUNTS
           ================================================= */

        if (
          u.pathname ===
          "/api/accounts"
        ) {
          if (
            !methodAllowed(
              req,
              res,
              ["GET"]
            )
          ) {
            return;
          }


          if (
            !requireAuthentication(
              session,
              res
            )
          ) {
            return;
          }


          const {
            response,
            data
          } =
            await fetchJson(
              "https://api.derivws.com/trading/v1/options/accounts",
              {
                headers: {
                  Authorization:
                    `Bearer ${session.token}`
                }
              }
            );


          if (!response.ok) {
            return json(
              res,
              response.status,
              {
                error:
                  data?.error ||
                  "Unable to load trading accounts"
              }
            );
          }


          return json(
            res,
            response.status,
            data
          );
        }


        /* =================================================
           ACCOUNT-SPECIFIC OTP
           ================================================= */

        if (
          u.pathname.startsWith(
            "/api/otp/"
          )
        ) {
          if (
            !methodAllowed(
              req,
              res,
              ["POST"]
            )
          ) {
            return;
          }


          if (
            !requireAuthentication(
              session,
              res
            )
          ) {
            return;
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
                error:
                  "Account ID required"
              }
            );
          }


          /*
             Verify the requested account belongs
             to this authenticated Deriv user.
          */

          const accountsResult =
            await fetchJson(
              "https://api.derivws.com/trading/v1/options/accounts",
              {
                headers: {
                  Authorization:
                    `Bearer ${session.token}`
                }
              }
            );


          if (
            !accountsResult
              .response
              .ok
          ) {
            return json(
              res,
              accountsResult
                .response
                .status,
              {
                error:
                  "Unable to verify account"
              }
            );
          }


          const raw =
            accountsResult.data
              ?.data ||
            accountsResult.data
              ?.accounts ||
            accountsResult.data ||
            [];


          const accountArray =
            Array.isArray(raw)
              ? raw
              : Array.isArray(
                    raw.accounts
                  )
                ? raw.accounts
                : [];


          const requestedAccount =
            accountArray.find(
              account => {
                const id =
                  String(
                    account
                      ?.account_id ||
                    account?.id ||
                    account
                      ?.loginid ||
                    ""
                  );

                return (
                  id ===
                  String(
                    accountId
                  )
                );
              }
            );


          if (
            !requestedAccount
          ) {
            return json(
              res,
              403,
              {
                error:
                  "Trading account is not available in this session"
              }
            );
          }


          const accountMode =
            detectAccountMode(
              requestedAccount
            );


          const otpResult =
            await fetchJson(
              "https://api.derivws.com/trading/v1/options/accounts/" +
                encodeURIComponent(
                  accountId
                ) +
                "/otp",
              {
                method:
                  "POST",

                headers: {
                  Authorization:
                    `Bearer ${session.token}`
                }
              }
            );


          if (
            !otpResult
              .response
              .ok
          ) {
            return json(
              res,
              otpResult
                .response
                .status,
              {
                error:
                  otpResult.data
                    ?.error ||
                  "Unable to create trading connection"
              }
            );
          }


          /*
             Preserve Deriv's existing response shape so
             the current app.js remains compatible.

             Metadata is added without exposing the OAuth
             access token.
          */

          const payload =
            otpResult.data &&
            typeof otpResult.data ===
              "object"
              ? {
                  ...otpResult.data,

                  velora: {
                    accountMode,

                    realExecutionEnabled:
                      REAL_TRADING_ENABLED
                  }
                }
              : otpResult.data;


          return json(
            res,
            otpResult
              .response
              .status,
            payload
          );
        }


        /* =================================================
           REAL EXECUTION STATUS

           This is deliberately server controlled.
           ================================================= */

        if (
          u.pathname ===
          "/api/real-execution/status"
        ) {
          if (
            !methodAllowed(
              req,
              res,
              ["GET"]
            )
          ) {
            return;
          }


          if (
            !requireAuthentication(
              session,
              res
            )
          ) {
            return;
          }


          return json(
            res,
            200,
            {
              enabled:
                REAL_TRADING_ENABLED,

              mode:
                REAL_TRADING_ENABLED
                  ? "AVAILABLE"
                  : "LOCKED",

              confirmationRequired:
                true
            }
          );
        }


        /* =================================================
           REAL EXECUTION GATE

           This endpoint intentionally does NOT place a
           transaction. It provides the server-controlled
           gate used by the confirmation workflow.
           ================================================= */

        if (
          u.pathname ===
          "/api/real-execution/check"
        ) {
          if (
            !methodAllowed(
              req,
              res,
              ["POST"]
            )
          ) {
            return;
          }


          if (
            !requireAuthentication(
              session,
              res
            )
          ) {
            return;
          }


          if (
            !REAL_TRADING_ENABLED
          ) {
            return json(
              res,
              423,
              {
                allowed:
                  false,

                error:
                  "REAL_EXECUTION_LOCKED",

                message:
                  "Real-money execution is disabled by the VELØRA server."
              }
            );
          }


          return json(
            res,
            200,
            {
              allowed:
                true,

              confirmationRequired:
                true,

              message:
                "Server execution gate is available. A specific transaction still requires explicit confirmation."
            }
          );
        }


        /* =================================================
           LOGOUT
           ================================================= */

        if (
          u.pathname ===
          "/api/logout"
        ) {
          if (
            !methodAllowed(
              req,
              res,
              ["POST"]
            )
          ) {
            return;
          }


          sessions.delete(
            sessionId
          );


          res.setHeader(
            "Set-Cookie",
            clearSessionCookie()
          );


          return json(
            res,
            200,
            {
              ok: true
            }
          );
        }


        /* =================================================
           STATIC FILES
           ================================================= */

        if (
          req.method !== "GET" &&
          req.method !== "HEAD"
        ) {
          return json(
            res,
            405,
            {
              error:
                "Method not allowed"
            }
          );
        }


        const file =
          u.pathname === "/"
            ? "index.html"
            : u.pathname.slice(1);


        const allowedFiles = [
          "index.html",
          "app.js",
          "style.css"
        ];


        if (
          !allowedFiles.includes(
            file
          )
        ) {
          return send(
            res,
            404,
            "Not found"
          );
        }


        const filePath =
          path.join(
            process.cwd(),
            "public",
            file
          );


        if (
          !fs.existsSync(
            filePath
          )
        ) {
          return send(
            res,
            404,
            "File not found"
          );
        }


        const contentType =
          file.endsWith(".html")
            ? "text/html; charset=utf-8"

            : file.endsWith(".js")
              ? "text/javascript; charset=utf-8"

              : "text/css; charset=utf-8";


        const body =
          fs.readFileSync(
            filePath
          );


        if (
          req.method ===
          "HEAD"
        ) {
          return send(
            res,
            200,
            "",
            contentType
          );
        }


        return send(
          res,
          200,
          body,
          contentType
        );


      } catch (error) {

        console.error(
          "VELØRA server error:",
          error
        );


        return json(
          res,
          500,
          {
            error:
              "Server error"
          }
        );
      }
    }
  );


/* =========================================================
   START SERVER
   ========================================================= */

server.listen(
  PORT,
  () => {

    console.log(
      `VELØRA listening on ${PORT}`
    );

    console.log(
      "REAL execution:",
      REAL_TRADING_ENABLED
        ? "ENABLED"
        : "LOCKED"
    );
  }
);

