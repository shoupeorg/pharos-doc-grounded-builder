#!/usr/bin/env node
import { retrieveDocumentation } from "./docs.js";
import { createPlan, executePlan, understand } from "./engine.js";

const args=process.argv.slice(2),execute=args[0]==="run",request=args.slice(execute?1:args[0]==="plan"?1:0).join(" ").trim();
if(!request){console.error('Usage: pharos-doc-builder <plan|run> "How do I ...?"');process.exitCode=2;}
else try{const understood=understand(request),documentation=await retrieveDocumentation({intent:understood.intent,request}),plan=createPlan({understood,documentation});const output={request,understood,documentation,plan};if(execute&&plan.status==="PLANNED")output.execution=await executePlan({understood,plan});console.log(JSON.stringify(output,null,2));if(execute&&output.execution?.status!=="VERIFIED")process.exitCode=1;}catch(error){console.error(JSON.stringify({status:"FAILED",error:error.message},null,2));process.exitCode=1;}
