---
name: pharos-doc-grounded-builder
description: Build cited, read-only Pharos Pacific Mainnet plans from official Developer Docs MCP, execute them through Pharos Chain MCP, and verify results on chain.
---

# Pharos Doc-Grounded Builder

Use this skill for supported read-only Pharos questions about native balances, ERC-20 metadata/balances, and existing transaction receipts.

## Required sequence

1. Run the CLI with `plan` so Developer Docs MCP retrieval occurs before any workflow action.
2. Check that the plan status is `PLANNED`, every step cites source IDs, and all required user inputs are explicit.
3. Only then run the same request with `run`.
4. Report each assertion as `VERIFIED`, `FAILED`, `UNKNOWN`, or `NOT_EXECUTED`.
5. If documentation coverage is insufficient, return `DOCS_NOT_COVERED` and do not execute Chain MCP calls.

```bash
npx pharos-doc-builder plan "How do I check the native balance of 0x...?"
npx pharos-doc-builder run "How do I check the native balance of 0x...?"
```

Never guess addresses, contracts, hashes, or networks. Never call signing or broadcast tools. This skill supports read-only tools only.
