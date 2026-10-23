import { CHAIN_MCP_URL, ENGINE_VERSION, NETWORK, READ_ONLY_TOOLS } from "./constants.js";
import { withMcp } from "./mcp-client.js";

const ADDRESS_SOURCE = "0x[a-fA-F0-9]{40}", ADDRESS = new RegExp(ADDRESS_SOURCE,"g"), HASH = /0x[a-fA-F0-9]{64}/g;
export const normalizeAddress = value => { const s = String(value || "").toLowerCase(); if (!/^0x[0-9a-f]{40}$/.test(s)) throw new Error(`Invalid EVM address: ${value}`); return s; };
const formatUnits = (raw, decimals) => { const s = BigInt(raw).toString().padStart(decimals + 1, "0"); if (!decimals) return s; const head = s.slice(0, -decimals), tail = s.slice(-decimals).replace(/0+$/, ""); return tail ? `${head}.${tail}` : head; };
function decodeUint(result, label) { const h = result?.result; if (!/^0x[0-9a-f]{64}$/i.test(h || "")) throw new Error(`${label} returned invalid ABI uint data.`); return BigInt(h); }
function decodeString(result, label) {
  const h = String(result?.result || "").slice(2); if (!/^[0-9a-f]+$/i.test(h) || h.length < 64) throw new Error(`${label} returned invalid ABI string data.`);
  try { const start = h.length === 64 ? 0 : 128, len = h.length === 64 ? 32 : Number(BigInt(`0x${h.slice(64,128)}`)); return new TextDecoder().decode(Uint8Array.from((h.slice(start,start+len*2).match(/../g)||[]).map(x=>parseInt(x,16)))).replace(/\0+$/, ""); } catch { throw new Error(`${label} could not be decoded.`); }
}
const balanceOfData = wallet => `0x70a08231${wallet.slice(2).padStart(64,"0")}`;
function labeledAddresses(request, role) {
  const label = role === "token" ? "(?:erc-?20(?:\\s+contract)?|token(?!\\s+balance)(?:\\s+contract)?|token\\s+contract)" : "(?:wallet|holder|owner|account)";
  const expression = new RegExp(`${label}\\s*(?:address)?\\s*(?:is|=|:)?\\s*(${ADDRESS_SOURCE})`,"ig");
  return [...new Set([...request.matchAll(expression)].map(match => match[1].toLowerCase()))];
}
const sourceIds = (documentation, operations) => [...new Set(operations.flatMap(operation => documentation.support?.[operation]?.sourceIds || []))];
const grounded = (documentation, operations) => Boolean(documentation.covered && operations.every(operation => documentation.support?.[operation]?.supported));
export function understand(requestInput) {
  const request = String(requestInput || "").trim(), lower = request.toLowerCase(), addresses = request.match(ADDRESS) || [], hashes = request.match(HASH) || [];
  let intent = "unsupported";
  if (/receipt|transaction status|tx status|gas used|verify.*transaction|transaction.*succeed/.test(lower)) intent = "transaction_receipt";
  else if (/erc-?20|token metadata|token balance|token contract|decimals|symbol/.test(lower)) intent = "erc20_balance";
  else if (/contract\s+(?:code|bytecode)|deployed\s+(?:code|bytecode)|bytecode\s+(?:at|for)/.test(lower)) intent = "contract_code";
  else if (/native balance|wallet balance|pros balance|balance.*wallet|how much pros/.test(lower)) intent = "native_balance";
  let parameters = {};
  if (intent === "transaction_receipt") parameters = { transactionHash: hashes[0] || null };
  else if (intent === "erc20_balance") {
    const tokens = labeledAddresses(request,"token"), wallets = labeledAddresses(request,"wallet");
    parameters = { token: tokens.length === 1 && tokens[0] !== wallets[0] ? tokens[0] : null, wallet: wallets.length === 1 && wallets[0] !== tokens[0] ? wallets[0] : null };
  } else if (intent === "contract_code") parameters = { contract: addresses.length === 1 ? addresses[0].toLowerCase() : null };
  else if (intent === "native_balance") parameters = { wallet: addresses[0]?.toLowerCase() || null };
  const missing = intent === "transaction_receipt" ? (!parameters.transactionHash ? ["transactionHash"] : []) : intent === "erc20_balance" ? [!parameters.token&&"token",!parameters.wallet&&"wallet"].filter(Boolean) : intent === "contract_code" ? (!parameters.contract?["contract"]:[]) : intent === "native_balance" ? (!parameters.wallet?["wallet"]:[]) : [];
  return { request, intent, parameters, missing, router: "deterministic validated intent router" };
}
export function createPlan({ understood, documentation }) {
  const required = understood.intent === "native_balance" ? ["network","eth_getBalance","eth_getBlockByNumber"] : understood.intent === "erc20_balance" ? ["network","eth_getCode","eth_call","erc20_name","erc20_symbol","erc20_decimals","erc20_balanceOf"] : understood.intent === "contract_code" ? ["network","eth_getCode","eth_getBlockByNumber"] : understood.intent === "transaction_receipt" ? ["network","eth_getTransactionByHash","eth_getTransactionReceipt","eth_getBlockByNumber"] : [];
  if (understood.missing.length) return { status: "NEEDS_INPUT", reason: `Missing required input: ${understood.missing.join(", ")}.`, steps: [] };
  if (understood.intent === "unsupported" || !grounded(documentation,required)) return { status: "DOCS_NOT_COVERED", reason: `Retrieved official documentation did not support every material operation.${documentation.refused?" Docs MCP explicitly refused coverage.":""}${documentation.missingOperations?.length?` Missing: ${documentation.missingOperations.join(", ")}.`:""}`, steps: [] };
  const common = { requiredInputs: understood.parameters, network: NETWORK, readOnly: true };
  if (understood.intent === "native_balance") return { status:"PLANNED", steps:[
    {id:"step-1",purpose:"Verify Pacific Mainnet identity and pin a block.",tool:"get_chain_info",arguments:{},expected:"chainId 1672 and a latest block",verification:"Compare MCP identity with the cited Pacific Mainnet documentation.",sourceIds:sourceIds(documentation,["network"]),...common},
    {id:"step-2",purpose:"Read the wallet native balance at the pinned block.",tool:"get_balance",arguments:{address:understood.parameters.wallet,block:"<pinned>"},expected:"Exact balanceWei",verification:"Validate unsigned integer and format with 18 decimals.",sourceIds:sourceIds(documentation,["eth_getBalance"]),...common},
    {id:"step-3",purpose:"Verify the pinned block independently.",tool:"get_block",arguments:{block:"<pinned>",includeTransactions:false},expected:"Matching block number and timestamp",verification:"Block number must equal the balance read block.",sourceIds:sourceIds(documentation,["eth_getBlockByNumber"]),...common}]};
  if (understood.intent === "erc20_balance") return { status:"PLANNED", steps:[
    {id:"step-1",purpose:"Verify Pacific Mainnet and pin a block.",tool:"get_chain_info",arguments:{},expected:"chainId 1672",verification:"Compare with cited docs.",sourceIds:sourceIds(documentation,["network"]),...common},
    {id:"step-2",purpose:"Verify deployed token bytecode.",tool:"get_code",arguments:{address:understood.parameters.token,block:"<pinned>"},expected:"Non-empty bytecode",verification:"Reject empty or failed code reads.",sourceIds:sourceIds(documentation,["eth_getCode"]),...common},
    {id:"step-3",purpose:"Read ERC-20 name, symbol, decimals, and wallet balance.",tool:"eth_call",arguments:{contract:understood.parameters.token,methods:["name()","symbol()","decimals()","balanceOf(address)"],block:"<pinned>"},expected:"ABI-decodable exact values",verification:"Decode values, verify decimals, and format only from raw integer.",sourceIds:sourceIds(documentation,["eth_call","erc20_name","erc20_symbol","erc20_decimals","erc20_balanceOf"]),...common}]};
  if (understood.intent === "contract_code") return { status:"PLANNED", steps:[
    {id:"step-1",purpose:"Verify Pacific Mainnet and pin a block.",tool:"get_chain_info",arguments:{},expected:"chainId 1672",verification:"Compare with cited docs.",sourceIds:sourceIds(documentation,["network"]),...common},
    {id:"step-2",purpose:"Read deployed contract bytecode at the pinned block.",tool:"get_code",arguments:{address:understood.parameters.contract,block:"<pinned>"},expected:"A hexadecimal bytecode result",verification:"Distinguish non-empty code from a successful empty-code read.",sourceIds:sourceIds(documentation,["eth_getCode"]),...common},
    {id:"step-3",purpose:"Verify the pinned block independently.",tool:"get_block",arguments:{block:"<pinned>",includeTransactions:false},expected:"Matching block number and timestamp",verification:"Block number must match the code read block.",sourceIds:sourceIds(documentation,["eth_getBlockByNumber"]),...common}]};
  return { status:"PLANNED", steps:[
    {id:"step-1",purpose:"Verify Pacific Mainnet identity.",tool:"get_chain_info",arguments:{},expected:"chainId 1672",verification:"Compare with cited docs.",sourceIds:sourceIds(documentation,["network"]),...common},
    {id:"step-2",purpose:"Read transaction and receipt.",tool:"get_transaction + get_transaction_receipt",arguments:{hash:understood.parameters.transactionHash},expected:"Matching hashes and inclusion data",verification:"Reconcile transaction, receipt, chain ID, status, gas, and block.",sourceIds:sourceIds(documentation,["eth_getTransactionByHash","eth_getTransactionReceipt"]),...common},
    {id:"step-3",purpose:"Verify the inclusion block independently.",tool:"get_block",arguments:{block:"<receipt block>",includeTransactions:false},expected:"Matching block hash/number",verification:"Receipt block must match the returned block.",sourceIds:sourceIds(documentation,["eth_getBlockByNumber"]),...common}]};
}
function traceCall(trace, stepId, call) { return async (name,args={}) => { if(!READ_ONLY_TOOLS.has(name)) throw new Error(`Tool ${name} is not on the read-only allowlist.`); const entry={sequence:trace.length+1,stepId,tool:name,arguments:args,startedAt:new Date().toISOString(),completedAt:null,status:"STARTED"};trace.push(entry);try{const value=await call(name,args);entry.completedAt=new Date().toISOString();entry.status="SUCCEEDED";return value;}catch(error){entry.completedAt=new Date().toISOString();entry.status="FAILED";entry.error=error.message;throw error;} }; }
export async function executePlan({ understood, plan }, options = {}) {
  if (plan.status !== "PLANNED") throw new Error("Only a persisted PLANNED run may execute.");
  const connector = options.connector || withMcp;
  return connector({url:CHAIN_MCP_URL,clientName:"pharos-doc-grounded-builder",timeoutMs:options.timeoutMs||30000,attempts:options.attempts||2}, async ({call}) => {
    const trace=[], assertions=[]; const c1=traceCall(trace,"step-1",call); const chain=await c1("get_chain_info");
    assertions.push({id:"chain-id",stepId:"step-1",status:chain.chainId===NETWORK.chainId?"VERIFIED":"FAILED",expected:NETWORK.chainId,actual:chain.chainId});
    if(chain.chainId!==NETWORK.chainId) return {status:"FAILED",trace,assertions,result:{reason:"Wrong chain."}};
    const block=String(chain.latestBlock);
    if(understood.intent==="native_balance") {
      const c2=traceCall(trace,"step-2",call), c3=traceCall(trace,"step-3",call); const balance=await c2("get_balance",{address:understood.parameters.wallet,block}); const blockData=await c3("get_block",{block,includeTransactions:false});
      const valid=/^\d+$/.test(balance.balanceWei||""), blockMatch=BigInt(blockData.number)===BigInt(block);
      assertions.push({id:"balance-integer",stepId:"step-2",status:valid?"VERIFIED":"FAILED",actual:balance.balanceWei},{id:"pinned-block",stepId:"step-3",status:blockMatch?"VERIFIED":"FAILED",expected:block,actual:String(BigInt(blockData.number))});
      return finish(trace,assertions,{classification:"READ_VERIFIED",workflow:"native_balance",chainId:chain.chainId,blockNumber:block,blockTimestamp:Number(BigInt(blockData.timestamp)),wallet:understood.parameters.wallet,balanceRaw:balance.balanceWei,balance:valid?formatUnits(balance.balanceWei,18):null,decimals:18,symbol:balance.symbol||NETWORK.nativeSymbol});
    }
    if(understood.intent==="erc20_balance") {
      const c2=traceCall(trace,"step-2",call),c3=traceCall(trace,"step-3",call), token=understood.parameters.token,wallet=understood.parameters.wallet; const code=await c2("get_code",{address:token,block}); const [nameR,symbolR,decR,balR]=await Promise.all([c3("eth_call",{transaction:{to:token,data:"0x06fdde03"},block}),c3("eth_call",{transaction:{to:token,data:"0x95d89b41"},block}),c3("eth_call",{transaction:{to:token,data:"0x313ce567"},block}),c3("eth_call",{transaction:{to:token,data:balanceOfData(wallet)},block})]);
      const hasCode=/^0x[0-9a-f]+$/i.test(code.code||"")&&code.code!=="0x",decimals=Number(decodeUint(decR,"decimals()")),raw=decodeUint(balR,"balanceOf()").toString(),name=decodeString(nameR,"name()"),symbol=decodeString(symbolR,"symbol()");
      const decoded=Number.isInteger(decimals)&&decimals>=0&&decimals<=255; assertions.push({id:"deployed-code",stepId:"step-2",status:hasCode?"VERIFIED":"FAILED"},{id:"erc20-decode",stepId:"step-3",status:decoded?"VERIFIED":"FAILED",actual:{name,symbol,decimals,balanceRaw:raw}});
      return finish(trace,assertions,{classification:"READ_VERIFIED",workflow:"erc20_balance",chainId:chain.chainId,blockNumber:block,tokenContract:token,wallet,name,symbol,decimals,balanceRaw:raw,balance:formatUnits(raw,decimals)});
    }
    if(understood.intent==="contract_code") {
      const c2=traceCall(trace,"step-2",call),c3=traceCall(trace,"step-3",call),address=understood.parameters.contract; const code=await c2("get_code",{address,block}); const blockData=await c3("get_block",{block,includeTransactions:false});
      const valid=/^0x[0-9a-f]*$/i.test(code.code||""),hasCode=valid&&code.code!=="0x",blockMatch=BigInt(blockData.number)===BigInt(block);
      assertions.push({id:"code-read",stepId:"step-2",status:valid?"VERIFIED":"FAILED",actual:valid?(hasCode?"DEPLOYED_BYTECODE":"NO_DEPLOYED_BYTECODE"):"INVALID"},{id:"pinned-block",stepId:"step-3",status:blockMatch?"VERIFIED":"FAILED",expected:block,actual:String(BigInt(blockData.number))});
      return finish(trace,assertions,{classification:"READ_VERIFIED",workflow:"contract_code",chainId:chain.chainId,blockNumber:block,blockTimestamp:Number(BigInt(blockData.timestamp)),contract:address,hasDeployedCode:hasCode,codeSizeBytes:valid?(code.code.length-2)/2:null});
    }
    const c2=traceCall(trace,"step-2",call),hash=understood.parameters.transactionHash,[tx,receipt]=await Promise.all([c2("get_transaction",{hash}),c2("get_transaction_receipt",{hash})]);
    if(!tx?.hash||!receipt?.transactionHash) { assertions.push({id:"receipt-found",stepId:"step-2",status:"FAILED"}); return finish(trace,assertions,{classification:"NOT_FOUND",workflow:"transaction_receipt",transactionHash:hash}); }
    const receiptBlock=String(BigInt(receipt.blockNumber)),c3=traceCall(trace,"step-3",call),blockData=await c3("get_block",{block:receiptBlock,includeTransactions:false}); const hashes=tx.hash.toLowerCase()===hash&&receipt.transactionHash.toLowerCase()===hash, blockMatch=BigInt(blockData.number)===BigInt(receipt.blockNumber)&&blockData.hash.toLowerCase()===receipt.blockHash.toLowerCase(),chainMatch=Number(BigInt(tx.chainId))===NETWORK.chainId,status=receipt.status==="0x1"?"SUCCEEDED":receipt.status==="0x0"?"REVERTED":"UNKNOWN";
    assertions.push({id:"hash-reconciliation",stepId:"step-2",status:hashes?"VERIFIED":"FAILED"},{id:"transaction-chain",stepId:"step-2",status:chainMatch?"VERIFIED":"FAILED",actual:Number(BigInt(tx.chainId))},{id:"inclusion-block",stepId:"step-3",status:blockMatch?"VERIFIED":"FAILED"},{id:"receipt-status",stepId:"step-2",status:status==="UNKNOWN"?"UNKNOWN":"VERIFIED",actual:status});
    return finish(trace,assertions,{classification:status==="SUCCEEDED"?"TRANSACTION_CONFIRMED":status,workflow:"transaction_receipt",chainId:chain.chainId,transactionHash:hash,from:tx.from,to:tx.to,blockNumber:receiptBlock,blockTimestamp:Number(BigInt(blockData.timestamp)),status,gasUsed:receipt.gasUsed?BigInt(receipt.gasUsed).toString():null,effectiveGasPrice:receipt.effectiveGasPrice?BigInt(receipt.effectiveGasPrice).toString():null});
  });
}
function finish(trace,assertions,result){const failed=assertions.some(x=>x.status==="FAILED"),unknown=assertions.some(x=>x.status==="UNKNOWN");return{engineVersion:ENGINE_VERSION,status:failed?"FAILED":unknown?"UNKNOWN":"VERIFIED",trace,assertions,result};}
