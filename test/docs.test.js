import test from "node:test";
import assert from "node:assert/strict";
import { parseSearch, retrieveDocumentation } from "../src/docs.js";

const page="https://docs.pharos.xyz/getting-started/network/pacific-mainnet";
const connector=({search=`Title: Pacific Mainnet\nLink: ${page}\nContent: Network chain ID RPC explorer`,content="Pharos Pacific Mainnet chain ID 1672, currency PROS, RPC and explorer.",answer="Supported by [Pacific Mainnet](https://docs.pharos.xyz/getting-started/network/pacific-mainnet)."}={})=>async(_opts,fn)=>fn({attempt:1,tools:[{name:"searchDocumentation"},{name:"getPage"},{name:"askQuestion"}],call:async name=>name==="searchDocumentation"?{text:search}:name==="getPage"?{text:content}:{text:answer}});
test("search parser accepts official docs only",()=>{const r=parseSearch(`Title: Good\nLink: ${page}\nContent: x\nTitle: Bad\nLink: https://evil.example/x\nContent: y`);assert.equal(r.length,1);assert.equal(r[0].url,page)});
test("native workflow is covered by verified network page",async()=>{const r=await retrieveDocumentation({intent:"native_balance",request:"balance"},{connector:connector()});assert.equal(r.covered,true);assert.equal(r.sources[0].id,"docs-1")});
test("ERC-20 requires relevant contract documentation",async()=>{const r=await retrieveDocumentation({intent:"erc20_balance",request:"token"},{connector:connector()});assert.equal(r.covered,false)});
test("transaction workflow accepts network explorer documentation",async()=>{const r=await retrieveDocumentation({intent:"transaction_receipt",request:"receipt"},{connector:connector()});assert.equal(r.covered,true)});
test("Docs MCP failure is explicit",async()=>{await assert.rejects(()=>retrieveDocumentation({intent:"native_balance",request:"x"},{connector:async()=>{throw new Error("fetch failed")}}),/fetch failed/)});
test("missing required Docs MCP tool fails closed",async()=>{await assert.rejects(()=>retrieveDocumentation({intent:"native_balance",request:"x"},{connector:async(_o,fn)=>fn({attempt:1,tools:[],call:async()=>({})})}),/missing required tools/)});
