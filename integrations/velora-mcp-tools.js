/**
 * VELØRA Connect — read-only MCP tool definitions and dispatcher.
 * Preparation only: this module is NOT mounted on a public route.
 * The hosting adapter must authenticate each request and provide
 * a per-user authorized read-only data source.
 */
export const VELORA_TOOLS = Object.freeze([
  {
    name: "velora_status",
    description: "Read VELØRA server health and demo-only configuration; never places trades.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "velora_demo_performance",
    description: "Read authenticated demo trade statistics; not investment advice.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "velora_recent_demo_trades",
    description: "Read recent settled demo trades for the authorized account.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
      additionalProperties: false
    }
  }
]);

/**
 * @param {string} name - MCP tool name
 * @param {object} args - validated tool arguments
 * @param {object} source - authorized, account-scoped read adapter
 * @returns {Promise<{content: Array<{type:string,text:string}>}>}
 */
export async function callVeloraTool(name, args = {}, source) {
  if (!source || typeof source.status !== "function" ||
      typeof source.performance !== "function" ||
      typeof source.trades !== "function") {
    throw new Error("Authorized VELØRA data source is not configured");
  }

  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Invalid arguments");
  }

  let result;
  if (name === "velora_status") {
    if (Object.keys(args).length) throw new Error("Unexpected arguments");
    result = await source.status();
  } else if (name === "velora_demo_performance") {
    if (Object.keys(args).length) throw new Error("Unexpected arguments");
    result = await source.performance();
  } else if (name === "velora_recent_demo_trades") {
    if (Object.keys(args).some(k => k !== "limit")) throw new Error("Unexpected arguments");
    const limit = args.limit === undefined ? 20 : args.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error("limit must be an integer between 1 and 50");
    }
    result = await source.trades(limit);
  } else {
    throw new Error("Unknown VELØRA tool");
  }

  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}
