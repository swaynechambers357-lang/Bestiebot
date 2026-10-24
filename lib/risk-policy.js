// Server-side policy primitives for the future order execution service.
// This module NEVER submits trades. Do not trust client-supplied P/L or counts.
export const DEFAULT_RISK_POLICY = Object.freeze({
  maxStake: 1,
  maxTradesPerDay: 5,
  maxDailyLoss: 5,
  allowedSymbol: "R_50",
  minDurationTicks: 1,
  maxDurationTicks: 10,
});

export function validateOrder({ accountId, authenticatedAccountId, mode, symbol, stake, durationTicks, confirmationId, proposalId }, ledger, policy = DEFAULT_RISK_POLICY) {
  if (!accountId || accountId !== authenticatedAccountId) return { allowed: false, reason: "ACCOUNT_MISMATCH" };
  if (mode !== "REAL") return { allowed: false, reason: "ACCOUNT_MODE_MISMATCH" };
  if (symbol !== policy.allowedSymbol) return { allowed: false, reason: "MARKET_NOT_ALLOWED" };
  if (!Number.isFinite(stake) || stake <= 0 || stake > policy.maxStake) return { allowed: false, reason: "STAKE_LIMIT" };
  if (!Number.isSafeInteger(durationTicks) || durationTicks < policy.minDurationTicks || durationTicks > policy.maxDurationTicks) return { allowed: false, reason: "DURATION_LIMIT" };
  if (typeof confirmationId !== "string" || !confirmationId || typeof proposalId !== "string" || !proposalId) return { allowed: false, reason: "CONFIRMATION_REQUIRED" };
  if (!ledger || !Number.isSafeInteger(ledger.tradesToday) || ledger.tradesToday < 0 || !Number.isFinite(ledger.realizedPnlToday)) return { allowed: false, reason: "LEDGER_UNAVAILABLE" };
  if (ledger.tradesToday >= policy.maxTradesPerDay) return { allowed: false, reason: "TRADE_LIMIT" };
  if (ledger.realizedPnlToday <= -policy.maxDailyLoss) return { allowed: false, reason: "DAILY_LOSS_LIMIT" };
  return { allowed: true };
}

// Before use in production: atomic ledger reservation, signed one-time
// consent bound to account+proposal+stake, Deriv-side reconciliation,
// concurrency locks, durable storage and account-owned server execution.
