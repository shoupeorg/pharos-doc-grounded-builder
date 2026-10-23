import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fetchJson, formatDiagnostic } from "./http-json.mjs";

const base=(process.env.DEMO_URL||"https://pharos-doc-grounded-builder.shoupeorg.workers.dev").replace(/\/$/, "");
const evidenceDir=resolve("evidence"),publicEvidenceDir=resolve("public/evidence");
const examples=[
  ["native","How do I check the native wallet balance of 0x15ddce897d76ac39c188ade4d353711a60395315 on Pharos Pacific Mainnet?"],
  ["erc20","How do I inspect ERC-20 token 0xc879c018db60520f4355c26ed1a6d572cdac1815 metadata and the token balance of wallet 0x15ddce897d76ac39c188ade4d353711a60395315?"],
  ["transaction","How do I verify whether transaction 0xa2d0fd2a0289352badaf4f151c46dfd807de12d7f43b4008f236e4ca7bfe6399 succeeded and inspect its block and gas?"],
  ["unsupported","How do I bridge Bitcoin to Pharos and earn guaranteed yield?"]
];

async function existing(name) {
  try {
    const value=JSON.parse(await readFile(resolve(evidenceDir,`live-${name}.json`),"utf8"));
    if ((name==="unsupported"&&value.status==="DOCS_NOT_COVERED"&&!value.trace?.length)||(name!=="unsupported"&&value.status==="VERIFIED")) return value;
  } catch {}
  return null;
}

async function main(){
  const workspaceResult=await fetchJson(`${base}/api/workspaces`,{method:"POST",attempts:3,timeoutMs:15000,retryUnexpectedHtml:true});
  const workspace=workspaceResult.data;
  if(!workspace?.workspaceId||!workspace?.capability)throw new Error(`Workspace response omitted required credentials. ${formatDiagnostic(workspaceResult.response)}`);
  const headers={"content-type":"application/json","x-workspace-id":workspace.workspaceId,"x-workspace-capability":workspace.capability};
  await mkdir(evidenceDir,{recursive:true});await mkdir(publicEvidenceDir,{recursive:true});const manifest={capturedAt:new Date().toISOString(),base,readOnly:true,runs:[]};
  for(const [name,request] of examples){
    let final=await existing(name);
    if(!final){
      const requestKey=`live-${name}-${crypto.randomUUID()}`;
      const plan=(await fetchJson(`${base}/api/plan`,{method:"POST",headers,body:JSON.stringify({request,requestKey}),attempts:3,timeoutMs:45000})).data;
      final=plan;
      if(plan.status==="PLANNED")final=(await fetchJson(`${base}/api/runs/${plan.id}/execute`,{method:"POST",headers,body:"{}",attempts:3,timeoutMs:90000})).data;
      if(name!=="unsupported"&&final.status!=="VERIFIED")throw new Error(`${name} was not VERIFIED: ${final.status} ${final.error||""}`);
      if(name==="unsupported"&&(final.status!=="DOCS_NOT_COVERED"||final.trace.length))throw new Error("Unsupported demonstration did not fail closed.");
      const saved=JSON.stringify(final,null,2)+"\n";await writeFile(resolve(evidenceDir,`live-${name}.json`),saved);await writeFile(resolve(publicEvidenceDir,`live-${name}.json`),saved);
    }
    manifest.runs.push({name,id:final.id,status:final.status,file:`live-${name}.json`,publicUrl:`${base}/evidence/live-${name}.json`,sourceCount:final.sources?.sources?.length||0,toolCalls:final.trace?.length||0});
  }
  const manifestText=JSON.stringify(manifest,null,2)+"\n";await writeFile(resolve(evidenceDir,"manifest.json"),manifestText);await writeFile(resolve(publicEvidenceDir,"manifest.json"),manifestText);console.log(JSON.stringify(manifest,null,2));
}

try { await main(); }
catch(error){ console.error(error?.message||String(error)); process.exitCode=1; }
