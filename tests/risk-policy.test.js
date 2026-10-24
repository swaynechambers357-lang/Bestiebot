import test from "node:test";
import assert from "node:assert/strict";
import { validateOrder } from "../lib/risk-policy.js";
const base = { accountId: "CR1", authenticatedAccountId: "CR1", mode: "REAL", symbol: "R_50", stake: 1, durationTicks: 10, confirmationId: "one-time-confirmation", proposalId: "proposal" };
const ledger = { tradesToday: 0, realizedPnlToday: 0 };
test("valid bounded order passes policy checks", () => assert.deepEqual(validateOrder(base, ledger), { allowed: true }));
for (const [name, order, state] of [
  ["wrong account", { authenticatedAccountId: "CR2" }, {}],
  ["wrong mode", { mode: "DEMO" }, {}],
  ["oversized stake", { stake: 10 }, {}],
  ["nonfinite stake", { stake: NaN }, {}],
  ["unapproved symbol", { symbol: "R_100" }, {}],
  ["duration out of range", { durationTicks: 11 }, {}],
  ["missing consent", { confirmationId: "" }, {}],
  ["daily trade cap", {}, { tradesToday: 5 }],
  ["daily loss cap", {}, { realizedPnlToday: -5 }],
  ["invalid ledger", {}, { tradesToday: -1 }]
]) test(name + " denied", () => assert.equal(validateOrder({ ...base, ...order }, { ...ledger, ...state }).allowed, false));
