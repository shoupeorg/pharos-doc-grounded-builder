import { DOCS_MCP_URL } from "./constants.js";
import { withMcp } from "./mcp-client.js";

const REQUIRED = ["searchDocumentation", "getPage", "askQuestion"];
const MATERIAL = {
  native_balance: ["network", "eth_getBalance", "eth_getBlockByNumber"],
  erc20_balance: ["network", "eth_getCode", "eth_call", "erc20_name", "erc20_symbol", "erc20_decimals", "erc20_balanceOf"],
  contract_code: ["network", "eth_getCode", "eth_getBlockByNumber"],
  transaction_receipt: ["network", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber"]
};
const SEARCHES = {
  native_balance: ["Pharos Pacific Mainnet chain ID 1672 RPC", "Pharos JSON-RPC eth_getBalance eth_getBlockByNumber"],
  erc20_balance: ["Pharos Pacific Mainnet chain ID 1672 RPC", "Pharos JSON-RPC eth_getCode eth_call", "Pharos ERC-20 name symbol decimals balanceOf contract interface"],
  contract_code: ["Pharos Pacific Mainnet chain ID 1672 RPC", "Pharos JSON-RPC eth_getCode eth_getBlockByNumber"],
  transaction_receipt: ["Pharos Pacific Mainnet chain ID 1672 RPC", "Pharos JSON-RPC eth_getTransactionByHash eth_getTransactionReceipt eth_getBlockByNumber gasUsed effectiveGasPrice"]
};
const TERM = {
  network: /(?:chain\s*id|chainid)[^\d]{0,30}1672/i,
  eth_getBalance: /\beth_getBalance\b/i,
  eth_getBlockByNumber: /\beth_getBlockByNumber\b/i,
  eth_getCode: /\beth_getCode\b/i,
  eth_call: /\beth_call\b/i,
  eth_getTransactionByHash: /\beth_getTransactionByHash\b/i,
  eth_getTransactionReceipt: /\beth_getTransactionReceipt\b/i,
  erc20_name: /\bname\s*\(\s*\)/i,
  erc20_symbol: /\bsymbol\s*\(\s*\)/i,
  erc20_decimals: /\bdecimals\s*\(\s*\)/i,
  erc20_balanceOf: /\bbalanceOf\s*\(\s*address\s*\)/i
};

const officialUrl = value => { try { const u = new URL(value); return u.protocol === "https:" && u.hostname === "docs.pharos.xyz" ? u.href : null; } catch { return null; } };
const textOf = value => String(value?.text ?? value ?? "");
export const normalizeMarkdownEscapes = value => textOf(value).replace(/\\([\\`*_{}\[\]()#+.!|>-])/g, "$1");
export function isExplicitRefusal(value) {
  const lines = normalizeMarkdownEscapes(value).split(/\n+/).filter(line => /\bDOCS_NOT_COVERED\b/i.test(line));
  return lines.some(line => !/DOCS_NOT_COVERED\s*(?:does\s+not\s+apply|:\s*no\b)/i.test(line) && !/\bnone\b[^\n]*\bDOCS_NOT_COVERED\b/i.test(line) && !/\bnot\s+DOCS_NOT_COVERED\b/i.test(line));
}

export function parseSearch(text) {
  const out = [], seen = new Set();
  for (const block of textOf(text).split(/(?=^Title:\s*)/gm)) {
    const title = block.match(/^Title:\s*(.+)$/m)?.[1]?.trim();
    const url = officialUrl(block.match(/^Link:\s*(\S+)$/m)?.[1]);
    if (!title || !url || seen.has(url)) continue;
    seen.add(url); out.push({ title, url });
  }
  return out;
}

function queryFor(intent, request) {
  if (intent === "unsupported") return [`${request} Pharos Pacific Mainnet official documentation`];
  return [...(SEARCHES[intent] || []), request];
}

const termsFor = intent => MATERIAL[intent] || [];

export function relevantExcerpt(content, intent) {
  const text = normalizeMarkdownEscapes(content).replace(/\r/g, "");
  const matches = [];
  for (const operation of termsFor(intent)) {
    const match = TERM[operation]?.exec(text);
    if (!match) continue;
    const index = match.index;
    const heading = text.lastIndexOf("\n#", index);
    const nextHeading = text.indexOf("\n#", index + match[0].length);
    const start = heading >= 0 ? heading + 1 : Math.max(0, index - 300);
    const end = nextHeading >= 0 ? nextHeading : Math.min(text.length, index + 1400);
    const section = text.slice(start, end).trim();
    if (section && !matches.includes(section)) matches.push(section);
  }
  return matches.join("\n\n").slice(0, 7000);
}

function supportFrom(sources) {
  const support = {};
  for (const [operation, pattern] of Object.entries(TERM)) {
    const sourceIds = sources.filter(source => pattern.test(normalizeMarkdownEscapes(source.excerpt))).map(source => source.id);
    support[operation] = { supported: sourceIds.length > 0, sourceIds };
  }
  return support;
}

export function coverageFor(intent, support, answer) {
  const requiredOperations = termsFor(intent);
  const missingOperations = requiredOperations.filter(operation => !support?.[operation]?.supported);
  const refused = isExplicitRefusal(answer);
  return { covered: Boolean(requiredOperations.length && !refused && !missingOperations.length), refused, requiredOperations, missingOperations };
}

function docsGoal(intent, pages) {
  const operations = termsFor(intent).join(", ") || "the requested workflow";
  const urls = pages.map(x => `- ${x.url}`).join("\n");
  return `Using only these retrieved complete official pages, determine whether they explicitly document every material operation for ${intent}: ${operations}. Network or token keywords alone are not support. Do not invent method or ABI semantics. Begin with exactly COVERED if all operations are documented, otherwise begin with exactly DOCS_NOT_COVERED. Do not mention DOCS_NOT_COVERED in a COVERED answer. Pages:\n${urls}`;
}

export async function retrieveDocumentation({ intent, request }, options = {}) {
  const retrievedAt = new Date().toISOString();
  const connector = options.connector || withMcp;
  return connector({ url: DOCS_MCP_URL, clientName: "pharos-doc-grounded-builder", timeoutMs: options.timeoutMs || 35000, attempts: options.attempts || 2 }, async ({ call, tools, attempt }) => {
    const names = tools.map(x => x.name), missing = REQUIRED.filter(x => !names.includes(x));
    if (missing.length) throw new Error(`Developer Docs MCP missing required tools: ${missing.join(", ")}`);
    const found = [], seen = new Set();
    for (const query of queryFor(intent, request)) {
      const search = await call("searchDocumentation", { query });
      for (const item of parseSearch(search)) if (!seen.has(item.url) && found.length < 8) { seen.add(item.url); found.push(item); }
    }
    const pages = [];
    for (const item of found) {
      const page = await call("getPage", { url: item.url });
      const excerpt = relevantExcerpt(textOf(page).trim(), intent);
      if (excerpt) pages.push({ ...item, excerpt });
    }
    const answer = pages.length ? textOf(await call("askQuestion", { question: request, goal: docsGoal(intent, pages) })) : "DOCS_NOT_COVERED";
    const sources = pages.map((page, index) => ({ id: `docs-${index + 1}`, title: page.title, url: page.url, retrievedAt, excerpt: page.excerpt }));
    const support = supportFrom(sources);
    const coverage = coverageFor(intent, support, answer);
    return { transport: "Developer Docs MCP", endpoint: DOCS_MCP_URL, retrievedAt, attempt, queries: queryFor(intent, request), answer: answer.slice(0, 4000), sources, support, ...coverage };
  });
}
