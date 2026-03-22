# Python Parity Closure Plan

## Overview

The Python AFD package already covers the result model, telemetry basics, handoff primitives, direct client support, platform helpers, and connector implementations, but it still lags the TypeScript core barrel in several shared contract areas.

As of March 21, 2026, the canonical parity check is:

```bash
uv run --project alfred alfred parity --path .
```

That command currently reports:

- `typescript`: 185 exports
- `python`: 170 exports
- `rust`: 211 exports
- `missing_from_python`: 90 exports

This plan tracks Python-side parity closure only. TypeScript remains the reference surface for shared core exports, and Rust is already caught up for `missing_from_rust`.

## Status

| Field | Value |
|---|---|
| Status | Active |
| Author | jasfalk |
| Updated | 2026-03-21 |
| Package | `python/src/afd` |
| Source Of Truth | `uv run --project alfred alfred parity --path .` |
| Depends On | Current TypeScript core barrel and existing Python package foundation |

## Problem

Python already has strong breadth, but the shared core API still drifts from the TypeScript reference in ways that matter for docs, examples, and cross-language expectations:

- command ergonomics are incomplete (`CommandExample`, `CommandHandler`, `CommandRegistry`, `validateCommandName`, registry helpers)
- MCP helper names and types are only partially aligned to the TypeScript contract
- pipeline execution, condition helpers, and result metadata exports are substantially incomplete
- some newer shared helpers are missing (`createProgressChunkWithSteps`, `createTimeoutController`, `McpId`, similarity helpers)
- several TypeScript concepts already have adjacent Python implementations, but not under the same public names

This creates three problems:

1. Python examples diverge from the TypeScript-first docs story
2. users moving between implementations cannot reliably infer the public API
3. parity drift is increasingly concentrated in the highest-leverage shared abstractions rather than edge utilities

## Current Reality

The official parity command currently reports these Python gap clusters:

- `30+` pipeline exports missing
- `20+` MCP exports missing
- `8` command/core exports missing
- `4` handoff/streaming helper exports missing
- `2` similarity exports missing
- several metadata and schema-alignment exports missing

The current Python package layout relevant to this work is:

- `python/src/afd/__init__.py`
- `python/src/afd/core/commands.py`
- `python/src/afd/core/mcp_types.py`
- `python/src/afd/core/pipeline.py`
- `python/src/afd/core/streaming.py`
- `python/src/afd/core/handoff.py`
- `python/src/afd/core/errors.py`
- `python/src/afd/core/metadata.py`
- `python/src/afd/direct.py`

## Scope

### In Scope

- close the `missing_from_python` list reported by `alfred parity`
- add or normalize missing public Python exports where TypeScript defines the intended shared contract
- update `python/src/afd/__init__.py` to reflect the intended public surface
- add or extend Python tests for newly aligned behavior
- keep Python docs honest about any intentional naming differences that remain

### Out of Scope

- removing Python-only exports from `extra_in_python` unless they conflict with the package direction
- closing `missing_from_typescript` items that belong in TS `client` or `server` rather than `core`
- reworking Python-only client/platform ergonomics that are already intentionally broader than TS core
- non-parity packaging or distribution work

## Principles

- prefer meaningful parity over placeholder aliases with no useful implementation
- when Python already has the concept, favor surfacing it under the shared contract name instead of duplicating behavior
- keep the top-level `afd` package readable; add modules only when the current core files would become misleadingly overloaded
- each wave should leave `__init__.py` and tests in a coherent state

## Workstreams

### Wave 1: Core Ergonomics And Low-Risk Shared Helpers

Goal: close the smallest, most broadly useful shared-contract gaps first.

Target areas:

- `core/commands.py`
  - `CommandExample`
  - `CommandHandler`
  - `CommandMiddleware`
  - `CommandRegistry`
  - `create_command_registry`
  - `command_to_mcp_tool`
  - `validate_command_name`
  - `JsonSchema`
- `core/streaming.py`
  - `create_progress_chunk_with_steps`
  - `create_timeout_controller`
- `core/errors.py`
  - `ErrorCode`
- `core/metadata.py`
  - `WarningSeverity`
- `__init__.py`
  - export alignment for all of the above

Why first:

- small blast radius
- improves examples and top-level package ergonomics immediately
- gives us the aliasing/export pattern we can reuse in later waves

### Wave 2: Handoff, MCP Names, And Shared Protocol Helpers

Goal: align the Python public contract around the MCP and handoff naming story.

Target areas:

- `core/handoff.py`
  - `CreateHandoffOptions`
  - `default_reconnect_policy`
  - `is_reconnect_policy`
- `core/mcp_types.py`
  - `McpId`
  - `McpClientCapabilities`
  - `McpContent`
  - `McpError`
  - `McpErrorCode`
  - `McpErrorCodes`
  - `McpImageContent`
  - `McpInitializeParams`
  - `McpInitializeResult`
  - `McpNotification`
  - `McpRequest`
  - `McpResourceContent`
  - `McpServerCapabilities`
  - `McpTextContent`
  - `McpTool`
  - `McpToolCallParams`
  - `McpToolCallResult`
  - `McpToolsListResult`
  - `create_mcp_request`
  - `create_mcp_response`
  - `create_mcp_error_response`
  - `is_mcp_request`
  - `is_mcp_response`
  - `is_mcp_notification`

Why second:

- Python already has adjacent MCP structures, so a coherent naming pass is likely higher leverage than piecemeal additions
- this unlocks a consistent shared terminology before the larger pipeline wave

### Wave 3: Pipeline Contract Parity

Goal: align Python with the TypeScript pipeline contract in one focused pass.

Target areas:

- pipeline types
  - `PipelineAlternative`
  - `PipelineCondition`
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
  - `PipelineContext`
  - `PipelineMetadata`
  - `PipelineOptions`
  - `PipelineRequest`
  - `PipelineSource`
  - `PipelineWarning`
  - `StepConfidence`
  - `StepReasoning`
  - `StepResult`
  - `StepStatus`
- pipeline helpers
  - `aggregate_pipeline_alternatives`
  - `aggregate_pipeline_confidence`
  - `aggregate_pipeline_reasoning`
  - `aggregate_pipeline_sources`
  - `aggregate_pipeline_warnings`
  - `build_confidence_breakdown`
  - `create_pipeline`
  - `evaluate_condition`
  - `get_nested_value`
  - `resolve_reference`
  - `resolve_variable`
  - `resolve_variables`
- pipeline guards
  - `is_and_condition`
  - `is_eq_condition`
  - `is_exists_condition`
  - `is_gt_condition`
  - `is_gte_condition`
  - `is_lt_condition`
  - `is_lte_condition`
  - `is_ne_condition`
  - `is_not_condition`
  - `is_or_condition`
  - `is_pipeline_condition`
  - `is_pipeline_request`
  - `is_pipeline_result`
  - `is_pipeline_step`
- execution
  - `CommandExecutor`
  - `execute_pipeline`

Why this is its own wave:

- this is the biggest remaining cluster
- behavior matters more than names here
- Python already has direct/pipeline-adjacent concepts, so we should land the full contract together rather than scatter partial aliases

### Wave 4: Similarity And Final Shared-Surface Cleanup

Goal: finish the smaller remaining shared helpers after pipeline parity lands.

Target areas:

- similarity helpers
  - `calculate_similarity`
  - `find_similar_tools`
- any remaining MCP or command exports left after Waves 1-3
- final `__init__.py` cleanup and parity verification pass

Why last:

- low blast radius
- easiest to finish cleanly once the larger pipeline and MCP surfaces are settled

## Testing Strategy

Each wave should include:

- focused Python tests for the touched module family
- top-level import coverage where new `afd` exports are added
- serialization or shape tests where shared cross-language structures are involved
- a parity rerun after each wave:

```bash
uv run --project alfred alfred parity --path .
```

## Success Criteria

This work is complete when:

- `missing_from_python` is reduced to zero or an explicitly justified residual list
- the Python top-level package exposes the intended shared contract names
- the added exports are backed by meaningful implementation or honest compatibility wrappers
- the Python skill/docs can be updated to describe the aligned public API without caveats in the completed areas

## Risks

- Python already has several adjacent concepts under different names; careless aliasing could make the package harder to understand
- pipeline parity may expose deeper behavior differences than the export list suggests
- some TypeScript-core concepts may need a Pythonic shape rather than a literal one-to-one copy
- `__init__.py` can become noisy if we add exports without keeping module organization readable

## Immediate Next Step

Start with a Wave 1 inventory against:

- `python/src/afd/core/commands.py`
- `python/src/afd/core/streaming.py`
- `python/src/afd/core/errors.py`
- `python/src/afd/core/metadata.py`
- `python/src/afd/__init__.py`

and determine which missing names are:

1. already implemented but not exported
2. implemented under adjacent names and need compatibility aliases
3. genuinely missing behavior that needs new code
