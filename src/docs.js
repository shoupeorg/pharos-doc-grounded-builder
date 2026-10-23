import { DOCS_MCP_URL } from "./constants.js";
import { withMcp } from "./mcp-client.js";

const REQUIRED = ["searchDocumentation", "getPage", "askQuestion"];
const officialUrl = value => { try { const u = new URL(value); return u.protocol === "https:" && u.hostname === "docs.pharos.xyz" ? u.href : null; } catch { return null; } };
const textOf = value => String(value?.text ?? value ?? "");
export function parseSearch(text) {
  const out = [], seen = new Set();
  for (const block of textOf(text).split(/(?=^Title:\s*)/gm)) {
    const title = block.match(/^Title:\s*(.+)$/m)?.[1]?.trim();
    const url = officialUrl(block.match(/^Link:\s*(\S+)$/m)?.[1]);
    if (!title || !url || seen.has(url)) continue;
    seen.add(url); out.push({ title, url, excerpt: block.match(/^Content:\s*([\s\S]*)$/m)?.[1]?.trim().slice(0, 600) || "" });
  }
  return out;
}
function queryFor(intent, request) {
  if (intent === "native_balance") return `Pharos Pacific Mainnet network chain ID RPC native currency wallet balance ${request}`;
  if (intent === "erc20_balance") return `Pharos Pacific Mainnet ERC-20 token contract interaction metadata balanceOf ${request}`;
  if (intent === "transaction_receipt") return `Pharos Pacific Mainnet explorer transaction receipt status block gas ${request}`;
  return `${request} Pharos Pacific Mainnet official documentation`;
}
function docsGoal(intent, pages) {
  const urls = pages.map(x => `- ${x.url}`).join("\n");
  return `Using only these retrieved complete official pages, identify what they support for ${intent}. State the documented network identity and any relevant contract, transaction, or explorer assumptions. Do not invent JSON-RPC behavior. If unsupported say DOCS_NOT_COVERED. Pages:\n${urls}`;
}
export async function retrieveDocumentation({ intent, request }, options = {}) {
  const retrievedAt = new Date().toISOString();
  const connector = options.connector || withMcp;
  return connector({ url: DOCS_MCP_URL, clientName: "pharos-doc-grounded-builder", timeoutMs: options.timeoutMs || 35000, attempts: options.attempts || 2 }, async ({ call, tools, attempt }) => {
    const names = tools.map(x => x.name), missing = REQUIRED.filter(x => !names.includes(x));
    if (missing.length) throw new Error(`Developer Docs MCP missing required tools: ${missing.join(", ")}`);
    const queries = intent === "unsupported" ? [queryFor(intent, request)] : ["Pharos Pacific Mainnet network chain ID RPC explorer", queryFor(intent, request)];
    const found = [], seen = new Set();
    for (const query of queries) {
      const search = await call("searchDocumentation", { query });
      for (const item of parseSearch(search)) if (!seen.has(item.url) && found.length < 4) { seen.add(item.url); found.push(item); }
    }
    const pages = [];
    for (const item of found) {
      const page = await call("getPage", { url: item.url });
      const content = textOf(page).trim();
      if (content) pages.push({ ...item, excerpt: content.replace(/\s+/g, " ").slice(0, 500) });
    }
    const answer = pages.length ? textOf(await call("askQuestion", { question: request, goal: docsGoal(intent, pages) })) : "DOCS_NOT_COVERED";
    const sources = pages.map((page, index) => ({ id: `docs-${index + 1}`, title: page.title, url: page.url, retrievedAt, excerpt: page.excerpt }));
    const hasNetwork = sources.some(x => /pacific-mainnet|network/i.test(`${x.url} ${x.title} ${x.excerpt}`));
    const relevant = intent === "native_balance" ? hasNetwork : intent === "erc20_balance" ? hasNetwork && sources.some(x => /token|erc-?20|contract|solidity/i.test(`${x.url} ${x.title} ${x.excerpt}`)) : intent === "transaction_receipt" ? hasNetwork && sources.some(x => /transaction|explorer|block|pacific-mainnet/i.test(`${x.url} ${x.title} ${x.excerpt}`)) : false;
    return { transport: "Developer Docs MCP", endpoint: DOCS_MCP_URL, retrievedAt, attempt, query: queryFor(intent, request), answer: answer.slice(0, 2500), sources, covered: Boolean(relevant && !/DOCS_NOT_COVERED/i.test(answer)) };
  });
}
