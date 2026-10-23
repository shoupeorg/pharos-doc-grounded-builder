# Pharos Doc-Grounded Builder Agent

A read-only documentation-to-execution workbench for Pharos Pacific Mainnet. It preserves an inspectable chain:

`request → Developer Docs MCP sources → persisted cited plan → Pharos Chain MCP calls → on-chain assertions → result`

The public UI, CLI, and root `SKILL.md` share the same engine. The router is deterministic and validated; it is not presented as an unrestricted LLM planner.

## Supported workflows

1. Native PROS wallet balance at a pinned block.
2. Arbitrary ERC-20 bytecode, name, symbol, decimals, and wallet balance at a pinned block.
3. Existing transaction receipt verification, including transaction/receipt hash reconciliation, chain ID, inclusion block, status, and historical gas fields when present.

Every workflow retrieves official documentation through Developer Docs MCP before a plan can exist. Documentation sources establish the Pharos network and relevant documented contract/explorer context. The actual read method schema is discovered from Pharos Chain MCP. If retrieved pages do not cover the workflow and Pacific Mainnet assumptions, the run becomes `DOCS_NOT_COVERED` and no Chain MCP tool is invoked.

## Evidence semantics

- `PLANNED`: sources and plan are persisted; no workflow call has run.
- `VERIFIED`: every required assertion passed.
- `FAILED`: at least one required assertion failed.
- `UNKNOWN`: a required result was unavailable.
- `DOCS_NOT_COVERED`: official retrieved material was insufficient; execution is blocked.
- `READ_VERIFIED`: a read-only state observation was established.
- `TRANSACTION_CONFIRMED`: an existing transaction receipt reported success and was reconciled to its transaction and block. The app did not submit it.

Plans cite source IDs. Tool traces cite plan step IDs. Assertions cite plan step IDs. Saved runs reopen as `HISTORICAL` without re-execution.

## Safety

The Chain MCP allowlist contains only `get_chain_info`, `get_balance`, `get_block`, `get_code`, `eth_call`, `get_transaction`, and `get_transaction_receipt`. There is no private key, signer, wallet approval, funding request, deployment, or broadcast path.

Anonymous workspaces use a random browser-held capability whose SHA-256 hash is stored in D1. A conditional status transition claims execution exactly once, so reloads and concurrent clicks do not silently rerun a plan.

## Development

```bash
npm ci
npm test
npm run build
```

The generated root `/worker.js` is ignored. `src/worker.js` is tracked.

CLI:

```bash
npm run cli -- plan "How do I check the native wallet balance of 0x...?"
npm run cli -- run "How do I verify whether transaction 0x... succeeded?"
```

## Public examples

The bundled examples use public third-party chain data, not project-controlled wallets:

- Wallet: `0x15ddce897d76ac39c188ade4d353711a60395315`
- USDC token: `0xc879c018db60520f4355c26ed1a6d572cdac1815`
- Existing transaction: `0xa2d0fd2a0289352badaf4f151c46dfd807de12d7f43b4008f236e4ca7bfe6399`

The unsupported example asks for a guaranteed-yield Bitcoin bridge. It is searched through Docs MCP, then refused if the retrieved sources do not establish support. No chain workflow call occurs.

## Accuracy and limitations

- Exact token amounts use `BigInt`; formatting occurs only after on-chain decimals are verified.
- Related reads are pinned where the Chain MCP accepts a block argument.
- A successful zero is distinct from a failed read.
- Transaction verification concerns an existing transaction; it does not establish intent, ownership history, or economic outcome.
- Developer Docs MCP synthesis and the live chain can change. Each source and observation records its retrieval time or block.
- Docs MCP or Chain MCP outages remain explicit recoverable failures; cached fixtures never substitute for live demonstrations.

## Deployment

The Worker uses Cloudflare D1 and static assets. Apply `migrations/0001_initial.sql`, build, and deploy with the checked-in `wrangler.jsonc`. Never commit Cloudflare credentials or local workspace capabilities.

## Reviewer flow

1. Choose `NATIVE BALANCE`, `ERC-20 INSPECTION`, or `VERIFY TRANSACTION`.
2. Select `RETRIEVE DOCS & BUILD PLAN →`.
3. Inspect `DOCS_MCP.SOURCES` and `GROUNDED_PLAN.JSON` before execution.
4. Select `EXECUTE PLAN`.
5. Inspect `MCP_TOOL_TRACE.LOG`, `ON_CHAIN_VERIFICATION`, and `FINAL_RESULT.JSON`.
6. Choose `UNSUPPORTED REQUEST`, build its plan, and confirm `DOCS_NOT_COVERED` with no tool trace.
7. Use `DOWNLOAD JSON` or `DOWNLOAD MARKDOWN` on a completed saved run.
