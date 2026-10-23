import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const base=process.env.DEMO_URL||"https://pharos-doc-grounded-builder.shoupeorg.workers.dev";
const evidenceDir=resolve("evidence"),publicEvidenceDir=resolve("public/evidence"), workspace=await fetch(`${base}/api/workspaces`,{method:"POST"}).then(async r=>{if(!r.ok)throw new Error(`Workspace HTTP ${r.status}: ${await r.text()}`);return r.json()});
const headers={"content-type":"application/json","x-workspace-id":workspace.workspaceId,"x-workspace-capability":workspace.capability};
const examples=[
  ["native","How do I check the native wallet balance of 0x15ddce897d76ac39c188ade4d353711a60395315 on Pharos Pacific Mainnet?"],
  ["erc20","How do I inspect ERC-20 token 0xc879c018db60520f4355c26ed1a6d572cdac1815 metadata and the token balance of wallet 0x15ddce897d76ac39c188ade4d353711a60395315?"],
  ["transaction","How do I verify whether transaction 0xa2d0fd2a0289352badaf4f151c46dfd807de12d7f43b4008f236e4ca7bfe6399 succeeded and inspect its block and gas?"],
  ["unsupported","How do I bridge Bitcoin to Pharos and earn guaranteed yield?"]
];
await mkdir(evidenceDir,{recursive:true});await mkdir(publicEvidenceDir,{recursive:true});const manifest={capturedAt:new Date().toISOString(),base,readOnly:true,runs:[]};
for(const [name,request] of examples){const plan=await fetch(`${base}/api/plan`,{method:"POST",headers,body:JSON.stringify({request,requestKey:`live-${name}-${Date.now()}`})}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(`${name} plan HTTP ${r.status}: ${JSON.stringify(d)}`);return d});let final=plan;if(plan.status==="PLANNED")final=await fetch(`${base}/api/runs/${plan.id}/execute`,{method:"POST",headers,body:"{}"}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(`${name} execute HTTP ${r.status}: ${JSON.stringify(d)}`);return d});if(name!=="unsupported"&&final.status!=="VERIFIED")throw new Error(`${name} was not VERIFIED: ${final.status} ${final.error||""}`);if(name==="unsupported"&&(final.status!=="DOCS_NOT_COVERED"||final.trace.length))throw new Error("Unsupported demonstration did not fail closed.");const saved=JSON.stringify(final,null,2)+"\n";await writeFile(resolve(evidenceDir,`live-${name}.json`),saved);await writeFile(resolve(publicEvidenceDir,`live-${name}.json`),saved);manifest.runs.push({name,id:final.id,status:final.status,file:`live-${name}.json`,publicUrl:`${base}/evidence/live-${name}.json`,sourceCount:final.sources?.sources?.length||0,toolCalls:final.trace?.length||0});}
const manifestText=JSON.stringify(manifest,null,2)+"\n";await writeFile(resolve(evidenceDir,"manifest.json"),manifestText);await writeFile(resolve(publicEvidenceDir,"manifest.json"),manifestText);console.log(JSON.stringify(manifest,null,2));
