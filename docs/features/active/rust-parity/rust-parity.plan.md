# Rust Parity Closure Plan

## Overview

The Rust AFD crate already covers the core result model, batch primitives, streaming basics, pipelines, bootstrap helpers, and handoff metadata, but it still lags the TypeScript barrel export surface in meaningful ways.

As of March 21, 2026, the canonical parity check is:

```bash
uv run --project alfred alfred parity --path .
```

That command currently reports:

- `typescript`: 183 exports
- `python`: 170 exports
- `rust`: 130 exports
- `missing_from_rust`: 78 exports

This plan tracks the Rust-side closure work only. TypeScript remains the source of truth for parity, and Python drift is out of scope except where it clarifies intended AFD behavior.

## Status

| Field | Value |
|---|---|
| Status | Active |
| Author | jasfalk |
| Updated | 2026-03-21 |
| Package | `packages/rust` |
| Source Of Truth | `uv run --project alfred alfred parity --path .` |
| Depends On | Existing Rust crate foundation in `docs/features/proposed/rust-support/` |

## Problem

Rust currently exposes only part of the AFD public surface expected by the TypeScript core package. The gaps are not cosmetic:

- core command ergonomics are missing (`ExposeOptions`, `defaultExpose`, `CommandExample`, `CommandMiddleware`, `validateCommandName`)
- the MCP type and helper layer is substantially incomplete
- pipeline condition types and executor-facing exports are incomplete
- telemetry, similarity, connector, and streaming helpers are missing
- some TypeScript helper constructors are missing even where Rust has adjacent functionality

This creates three problems:

1. the Rust implementation is harder to use consistently across examples and docs
2. the public API story drifts across languages even when concepts are shared
3. parity regressions are easy to miss because the missing areas are spread across multiple modules

## Current Reality

The official parity command currently reports these Rust gap clusters:

- `24` MCP exports missing
- `24` pipeline exports missing
- `8` connector exports missing
- `5` command/core helper exports missing
- `4` handoff exports missing
- `4` streaming exports missing
- `4` telemetry exports missing
- `3` error exports missing
- `2` similarity exports missing
- `1` batch export missing

The current Rust crate layout relevant to this work is:

- `packages/rust/src/commands.rs`
- `packages/rust/src/errors.rs`
- `packages/rust/src/handoff.rs`
- `packages/rust/src/pipeline.rs`
- `packages/rust/src/streaming.rs`
- `packages/rust/src/batch.rs`
- `packages/rust/src/lib.rs`

## Scope

### In Scope

- close the `missing_from_rust` list reported by `alfred parity`
- add missing public Rust types and helper functions where TypeScript already defines the public contract
- update `packages/rust/src/lib.rs` re-exports to match the intended public surface
- add or extend Rust tests for newly exposed behavior
- keep docs honest about any intentionally deferred items

### Out of Scope

- closing `missing_from_python`
- removing Rust-only exports from `extra_in_rust` unless they clearly conflict with the public API direction
- implementing Python-only or platform-only utilities that are not part of the TypeScript source-of-truth barrel
- private Mint distribution work

## Principles

- parity means behavior, not just names; do not add placeholder exports with no meaningful implementation
- TypeScript is the contract source, but Rust should stay idiomatic where implementation details differ
- prefer finishing one module family cleanly over scattering tiny partial fixes across the crate
- each wave should leave `lib.rs` and tests in a coherent state

## Workstreams

### Wave 1: Core Ergonomics And Low-Risk Helpers

Goal: close the smallest, highest-leverage missing exports first.

Target areas:

- `commands.rs`
  - `CommandExample`
  - `CommandMiddleware`
  - `ExposeOptions`
  - `defaultExpose`
  - `validateCommandName`
- `errors.rs`
  - `error`
  - `ErrorCode`
  - `wrapError` equivalent
- `batch.rs`
  - `BatchWarning`
- `streaming.rs`
  - `StreamableCommand`
  - `isStreamableCommand`
  - `consumeStream`
  - `createTimeoutController` or an honest Rust equivalent
- `lib.rs`
  - export alignment for all of the above

Why first:

- small blast radius
- improves everyday API ergonomics
- creates patterns for later parity additions

### Wave 2: Telemetry And Handoff Helper Completion

Goal: finish the missing support surfaces around trust signals and protocol transitions.

Target areas:

- `telemetry.rs` or equivalent new module if needed
  - `TelemetryEvent`
  - `TelemetrySink`
  - `createTelemetryEvent`
  - `isTelemetryEvent`
- `handoff.rs`
  - `createHandoff`
  - `CreateHandoffOptions`
  - `defaultReconnectPolicy`
  - `isReconnectPolicy`

Why second:

- these are well-bounded features with clear TypeScript precedents
- they unblock richer examples and downstream parity stories without requiring the full MCP stack rewrite first

### Wave 3: MCP Surface Parity

Goal: close the full protocol-type gap in one coherent pass.

Target areas:

- request/response helpers
  - `createMcpRequest`
  - `createMcpResponse`
  - `createMcpErrorResponse`
- protocol guards
  - `isMcpRequest`
  - `isMcpResponse`
  - `isMcpNotification`
- public types
  - `McpClientCapabilities`
  - `McpContent`
  - `McpError`
  - `McpErrorCode`
  - `McpImageContent`
  - `McpInitializeParams`
  - `McpInitializeResult`
  - `McpNotification`
  - `McpRequest`
  - `McpResourceContent`
  - `McpResponse`
  - `McpServerCapabilities`
  - `McpTextContent`
  - `McpToolCallParams`
  - `McpToolCallResult`
  - `McpToolsListResult`
  - `textContent`
  - `McpErrorCodes`

Why this is its own wave:

- the missing items form a protocol family
- consistency matters more here than piecemeal export closure
- this work likely touches serialization, validation, and docs together

### Wave 4: Pipeline Surface Parity

Goal: align Rust with the TypeScript pipeline contract, including conditions and executor helpers.

Target areas:

- `PipelineConditionAnd`
- `PipelineConditionEq`
- `PipelineConditionExists`
- `PipelineConditionGt`
- `PipelineConditionGte`
- `PipelineConditionLt`
- `PipelineConditionLte`
- `PipelineConditionNe`
- `PipelineConditionNot`
- `PipelineConditionOr`
- `isAndCondition`
- `isEqCondition`
- `isExistsCondition`
- `isGtCondition`
- `isGteCondition`
- `isLtCondition`
- `isLteCondition`
- `isNeCondition`
- `isNotCondition`
- `isOrCondition`
- `isPipelineCondition`
- `CommandExecutor`
- `executePipeline`
- `resolveReference`

Why this is a separate wave:

- pipeline parity affects execution semantics, not just typing
- this is one of the largest remaining clusters
- it deserves focused tests instead of being mixed into protocol work

### Wave 5: Connector And Similarity Completion

Goal: finish the remaining ecosystem-facing helpers.

Target areas:

- connector types
  - `GitHubConnectorOptions`
  - `Issue`
  - `IssueCreateOptions`
  - `IssueFilters`
  - `PackageManager`
  - `PackageManagerConnectorOptions`
  - `PrCreateOptions`
  - `PullRequest`
- similarity helpers
  - `calculateSimilarity`
  - `findSimilarTools`

Why last:

- important for breadth, but not required to make the Rust core feel structurally complete
- easier to slot in once the protocol and pipeline foundations are settled

## Testing Strategy

Each wave should include:

- targeted Rust unit tests in `packages/rust`
- serialization tests for shared public types where relevant
- one parity check run before merge:

```bash
uv run --project alfred alfred parity --path .
```

Recommended checkpoint commands:

```bash
cargo test
uv run --project alfred alfred parity --path .
```

## Acceptance Criteria

- `missing_from_rust` is reduced to zero, or any remaining entries are explicitly documented as intentionally non-parity items with a reason
- `packages/rust/src/lib.rs` reflects the intended public AFD Rust surface cleanly
- newly exported items have real implementations or well-tested Rust-native equivalents
- the parity command is used as the final verification gate for each wave

## Open Questions

### 1. MCP Module Shape

The Rust crate currently re-exports several MCP-adjacent command types from `commands.rs`, but the missing MCP surface suggests a dedicated `mcp.rs` module may now be cleaner.

Recommendation:

- allow a new Rust module split if it reduces confusion and makes parity easier to maintain

### 2. Timeout Controller Semantics

`createTimeoutController` is a JavaScript-shaped helper. Rust may need an equivalent with a different internal design.

Recommendation:

- match the public intent, not the JS implementation detail
- document the Rust-native timeout model if naming must stay aligned

### 3. Connector Depth

Some connector items may be type-only parity shims if the full runtime integration is not yet in scope.

Recommendation:

- add shared public types first
- only add runtime connector behavior when the Rust crate is ready to support it honestly

## Follow-On Work

Once this plan is complete, reassess:

- whether `docs/features/proposed/rust-support/` should move from proposed to complete
- whether `alfred parity` should gain a narrower Rust-only mode or machine-readable wave summaries
- whether parity should become part of regular Rust CI for the crate
