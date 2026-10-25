# VELØRA release gates — October 2026

## Current decision
**NO-GO for real-money execution.** Preserve the real-account features and previews in source, but keep the server master lock disabled until a separate enforceable server-side trading gateway exists. The development branch currently denies REAL account trading OTP while locked. This also temporarily blocks real-account preview on that branch. Production main is not changed.

## Demo acceptance tests (must record screenshots/logs and actual results)
1. Log in with demo account A on device A; verify R_50 feed and account ID.
2. Log in with demo account B on device B simultaneously; verify B cannot view A's balances, contracts or session.
3. Switch A between accounts and refresh; verify all account-specific state resets.
4. Log out A; verify its session and OTP endpoints deny subsequent access; B must remain active.
5. Disconnect network during an open demo contract; reconnect and reconcile contract once only.
6. Validate EMA20, EMA50 and RSI14 against independently computed candle/tick reference values.
7. Verify strategy signal cooldown and entry conditions with fixed reproducible tick fixtures.
8. Verify demo order stake/duration, payout, buy response, settlement and actual P/L with receipts.
9. Verify duplicate-click and retry cannot submit duplicate buys.
10. Verify malformed session, expired token, missing OAuth state, cross-account account ID, and CSRF-related cases fail safely.

## Real execution security gate
- Browser-held trading credentials must not be sufficient to bypass risk limits.
- Order authorization and execution must be mediated by trusted server-side controls.
- Server must enforce account ownership, stake/duration limits, daily loss and trade caps, deduplication, and explicit per-order confirmation.
- Fail closed when session, price, connection, or risk state is uncertain.
- Keep REAL_TRADING_ENABLED=false until a reviewed, reproducible test suite passes.

## Jarvis integration gate
- Only user-authorized, read-only status endpoints; no account tokens, OTPs, order placement or deposits.
- No private Deriv keys in the Android app.
- Require authentication, session expiry, and account isolation for status queries.

## Release status
Code review started; tests above **not yet passed or executed as a complete suite**. Do not represent VELØRA as complete, safe for real funds, or ready for public beta.
