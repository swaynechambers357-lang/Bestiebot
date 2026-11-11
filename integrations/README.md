# VELØRA Connect — integration checklist

Status: **PREPARATION ONLY**. The MCP tools are not registered in ChatGPT or served over HTTP.

## Available read-only tool contracts

- `velora_status`: server health, demo status, real-execution lock
- `velora_demo_performance`: sample size, win rate, P/L, drawdown, streaks
- `velora_recent_demo_trades`: last 1–50 settled demo trades

Implementation: `integrations/velora-mcp-tools.js`. The dispatcher requires an **authorized account-scoped data source**; it cannot read Deriv credentials or execute transactions.

## Security requirements before exposing the connector

1. Verify which custom MCP transport and authentication scheme the target ChatGPT account supports.
2. Implement authenticated HTTPS MCP transport and reject requests without valid authorization. Do not put bearer tokens or API keys in GitHub, URLs, screenshots, or browser source.
3. Bind the authenticated ChatGPT identity to a specific authorized VELØRA/Deriv demo account. Never share the process-wide journal between users.
4. Replace the current per-session, in-memory trade journal with durable storage and explicit retention/deletion policy; record trade metadata (strategy version, signal reason, duration, stake, payout, timestamp) to enable meaningful analysis.
5. Verify trades against the broker's authorized demo transaction data; current browser-posted journal is not independently verified and can be incomplete.
6. Add rate limiting, audit logging, redaction, and authorization/integration tests.
7. Keep the server-side real execution lock intact. Expose **no** trading, account switching, or stake-changing tools.
8. Only after successful tests: register the HTTPS MCP URL in the **same** ChatGPT account and complete the connection approval.

## Existing endpoints

- `/api/health` — public health response
- `/api/command-center/trades` — authenticated browser session journal, volatile
- `/api/command-center/analysis` — authenticated session analytics, volatile

The browser-session endpoints are **not** an MCP integration. The module in this branch deliberately has no public listener, so merging it would not connect ChatGPT by itself.
