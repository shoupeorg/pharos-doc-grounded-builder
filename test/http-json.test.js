import test from "node:test";
import assert from "node:assert/strict";
import { fetchJson, HttpJsonError } from "../scripts/http-json.mjs";

test("HTML API fallback reports bounded response metadata without parsing or leaking capabilities", async () => {
  let calls=0;
  const html="<!doctype html><html><body>static fallback capability=do-not-print</body></html>";
  const fetchImpl=async()=>{calls++;return new Response(html,{status:200,headers:{"content-type":"text/html; charset=UTF-8"}})};
  await assert.rejects(
    fetchJson("https://example.test/api/workspaces",{method:"POST",fetchImpl,attempts:1}),
    error=>error instanceof HttpJsonError&&error.details.status===200&&error.details.contentType.startsWith("text/html")&&!error.message.includes("do-not-print")&&error.details.first300.length<=300
  );
  assert.equal(calls,1);
});

test("transient responses retry at most three times and return JSON", async () => {
  let calls=0;
  const fetchImpl=async()=>{calls++;return calls<3?new Response("busy",{status:503,headers:{"content-type":"text/plain"}}):new Response('{"ok":true}',{status:200,headers:{"content-type":"application/json"}})};
  const result=await fetchJson("https://example.test/api/workspaces",{method:"POST",fetchImpl,attempts:3,timeoutMs:1000});
  assert.deepEqual(result.data,{ok:true});
  assert.equal(calls,3);
});

test("non-transient failures are not retried", async () => {
  let calls=0;
  const fetchImpl=async()=>{calls++;return new Response('{"error":"bad"}',{status:400,headers:{"content-type":"application/json"}})};
  await assert.rejects(fetchJson("https://example.test/api/workspaces",{method:"POST",fetchImpl,attempts:3}),HttpJsonError);
  assert.equal(calls,1);
});
