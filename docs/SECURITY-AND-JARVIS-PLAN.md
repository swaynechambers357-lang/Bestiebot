# VELØRA security and JARVIS integration checklist

Status: work in progress; not production-certified. Production `main` must remain unchanged until tests pass.

## Current observations
- Two different Deriv demo account IDs appeared on two phones and both received R_50 ticks.
- This does not prove server-side account isolation, long-term stability, or trading safety.
- Real trading is currently intended to remain disabled.

## Required before live trading
1. Verify OAuth state, PKCE, session rotation, cookie flags, logout revocation, and cross-user session isolation.
2. Verify account ownership on every API request and OTP issue; no cross-user cached account data.
3. Keep `REAL_TRADING_ENABLED=false`; do not rely on frontend badges for security.
4. Ensure no unrestricted client-side trading credentials can bypass server risk checks; implement enforceable server-side order authorization before enabling live execution.
5. Validate stake, duration, daily loss/trade caps, duplicate-order prevention, and reconnect behavior server-side.
6. Test Strategy B indicators, signal timing, proposal pricing, demo buy/settlement accounting, and disconnect recovery.
7. Verify simultaneous sessions on separate devices and account switching/logout invalidation.

## JARVIS (separate private Android repository)
- JARVIS should receive only per-user, read-only status data: feed health, scanner state, aggregate demo performance, and risk alerts.
- Never expose Deriv OAuth tokens, WebSocket OTPs, session cookies, trading authorization, or personal account details to JARVIS.
- Design a narrow authenticated read-only endpoint with explicit scopes, short-lived credentials, revocation, and rate limiting.
- No order placement, stake changes, deposits, withdrawals, or enabling real execution through JARVIS.

## Release criteria
- Automated tests for session/account isolation, auth failures, feed lifecycle, and trade gates.
- Review all changes on a non-production branch, then deploy to staging before any production merge.
