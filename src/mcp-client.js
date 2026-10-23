import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const transient = error => /timeout|fetch failed|session capacity|429|502|503|504/i.test(String(error?.message || error));

export function parseToolJson(result, name) {
  if (result?.isError) throw new Error(`${name} failed: ${result.content?.map(x => x.text || "").join(" ") || "unknown MCP error"}`);
  const text = result?.content?.find(item => item.type === "text")?.text;
  if (!text) throw new Error(`${name} returned no text result.`);
  try { return JSON.parse(text); } catch { return { text }; }
}

export async function withMcp({ url, clientName, timeoutMs = 30000, attempts = 2 }, fn) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const client = new Client({ name: clientName, version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(url), { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(timeoutMs) }) });
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      const call = async (name, args = {}) => parseToolJson(await client.callTool({ name, arguments: args }), name);
      return await fn({ call, tools, attempt });
    } catch (error) {
      last = error;
      if (attempt === attempts || !transient(error)) throw error;
      await sleep(400 * attempt);
    } finally {
      try { await transport.terminateSession(); } catch {}
      try { await client.close(); } catch {}
    }
  }
  throw last;
}
