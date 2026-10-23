import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fetchJson } from "./http-json.mjs";

const base=(process.env.DEMO_URL||"https://pharos-doc-grounded-builder.shoupeorg.workers.dev").replace(/\/$/,"");
const evidenceDir=resolve("evidence"),publicEvidenceDir=resolve("public/evidence");
const cases=[
  {name:"native",request:"How do I check the native wallet balance of 0x15ddce897d76ac39c188ade4d353711a60395315 on Pharos Pacific Mainnet?",expected:"VERIFIED"},
  {name:"contract-code",request:"Does contract 0xc879c018db60520f4355c26ed1a6d572cdac1815 have deployed bytecode on Pharos Pacific Mainnet?",expected:"VERIFIED"},
  {name:"transaction",request:"How do I verify whether transaction 0xa2d0fd2a0289352badaf4f151c46dfd807de12d7f43b4008f236e4ca7bfe6399 succeeded and inspect its block and gas?",expected:"VERIFIED"},
  {name:"erc20-refusal",request:"How do I inspect ERC-20 token 0xc879c018db60520f4355c26ed1a6d572cdac1815 metadata and the token balance of wallet 0x15ddce897d76ac39c188ade4d353711a60395315?",expected:"DOCS_NOT_COVERED"}
];

async function save(name,value){const text=JSON.stringify(value,null,2)+"\n";await writeFile(resolve(evidenceDir,name),text);await writeFile(resolve(publicEvidenceDir,name),text)}

async function main(){
  const meta=(await fetchJson(`${base}/api/meta`,{attempts:3,timeoutMs:15000,retryUnexpectedHtml:true})).data;
  if(meta.engineVersion!=="doc-grounded-builder/1.1.0-doc-coverage")throw new Error(`Unexpected deployed engine: ${meta.engineVersion}`);
  const workspace=(await fetchJson(`${base}/api/workspaces`,{method:"POST",attempts:3,timeoutMs:15000,retryUnexpectedHtml:true})).data;
  if(!workspace?.workspaceId||!workspace?.capability)throw new Error("Workspace response omitted required credentials.");
  const headers={"content-type":"application/json","x-workspace-id":workspace.workspaceId,"x-workspace-capability":workspace.capability};
  await mkdir(evidenceDir,{recursive:true});await mkdir(publicEvidenceDir,{recursive:true});
  const manifest={evidenceVersion:"1.1",engineVersion:meta.engineVersion,capturedAt:new Date().toISOString(),base,readOnly:true,runs:[]};
  for(const item of cases){
    const plan=(await fetchJson(`${base}/api/plan`,{method:"POST",headers,body:JSON.stringify({request:item.request,requestKey:`v1.1-${item.name}-${crypto.randomUUID()}`}),attempts:3,timeoutMs:60000})).data;
    let final=plan;
    if(plan.status==="PLANNED")final=(await fetchJson(`${base}/api/runs/${plan.id}/execute`,{method:"POST",headers,body:"{}",attempts:3,timeoutMs:90000})).data;
    if(final.status!==item.expected)throw new Error(`${item.name} expected ${item.expected}, received ${final.status}: ${final.error||final.plan?.reason||""}`);
    if(item.expected==="DOCS_NOT_COVERED"&&(final.trace?.length||final.plan?.steps?.length))throw new Error(`${item.name} refusal attempted execution.`);
    const file=`v1.1-live-${item.name}.json`,record={evidenceVersion:"1.1",engineVersion:meta.engineVersion,...final};await save(file,record);
    manifest.runs.push({name:item.name,id:final.id,status:final.status,file,publicUrl:`${base}/evidence/${file}`,sourceCount:final.sources?.sources?.length||0,toolCalls:final.trace?.length||0,refused:Boolean(final.sources?.refused)});
  }
  await save("manifest-v1.1.json",manifest);console.log(JSON.stringify(manifest,null,2));
}

try{await main()}catch(error){console.error(error?.message||String(error));process.exitCode=1}
