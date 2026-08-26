---
name: data-juicer-plan-flow
description: Plan, approve, execute, and recover reproducible Data-Juicer cleaning tasks through the mcp__dj__ plan-flow tools. Use for formal data processing that needs clarification, review, versioned plans, or reports.
user-invocable: true
auto_load: true
---

# Data-Juicer Plan Flow

Use one DSH agent. The MCP is a capability, persistence, and execution layer; it is not another agent. Use the workspace selected by the user, and pass its absolute path as `workspace_root` on every workspace-scoped call.

The MCP server has no independent business workspace. Its source directory and process cwd are implementation details and must never be used as `workspace_root`. Obtain the current workspace from the DSH session and pass its absolute path on every workspace-scoped call. Resolve every relative user path from that root. Do not ask the user to copy workspace data into the MCP source tree or request elevated access to it.

## Workflow

1. Determine whether the request identifies the input, desired outputs, material constraints, and acceptance criteria. If a missing choice would materially change the pipeline, use `ask_user_question` to resolve it; do not substitute an assumption or a plain-text question.
2. Before inspecting data or planning, summarize the understood requirements as a concise brief covering input, outputs, transformations, constraints, and acceptance criteria. Always call `ask_user_question` with the choices `Confirm and plan`, `Revise requirements`, and `Cancel`. Continue only when the returned answer is exactly `Confirm and plan`; the original request itself is not confirmation.
3. Call `mcp__dj__inspect_input` for local input. Search independent requirements with `mcp__dj__search_capabilities`; independent searches may run in parallel. Use only its `runtime` object to learn server configuration. Never read or inspect an environment file through DSH tools.
4. Put supported Data-Juicer steps in `plan.recipe.process`. If a focused search finds no suitable operator, propose a generic Python artifact in top-level `plan.postprocess`; do not search indefinitely. Never place postprocess configuration inside `recipe`.
5. Call `mcp__dj__prepare_plan`. For a revision, reuse its `task_id` and pass the prior `plan_version` as `base_plan_version`. Every call creates a new immutable `plan_vNNN`; never edit an existing plan bundle.
6. Present the normalized recipe, important parameters, postprocess steps, risks, validation findings, version diff, and `content_hash`. Then always call `ask_user_question` with `Approve and run`, `Revise plan`, and `Cancel`. Call `mcp__dj__approve_plan` only when the returned answer is exactly `Approve and run`; a chat acknowledgement is not approval. A revised plan requires a new review question.
7. After approval, call `mcp__dj__approve_plan` with the exact `task_id`, `plan_version`, and `content_hash`, then call `mcp__dj__run_plan`.
8. Poll `mcp__dj__get_run`. On failure, inspect its logs first. Retry unchanged transient failures only when safe. If recipe, artifacts, paths, or semantics must change, prepare a new version and obtain approval again. Use `mcp__dj__cancel_run` only when requested or continuing is unsafe.
9. On success, return the task id, plan version, run id, output directory, materialized recipe, and report path.

`mcp__dj__preview_plan` is a non-executing preflight summary. It does not replace validation or approval.

## Plan Contract

Keep the human-facing plan in this shape:

```yaml
user_intent: "..."
modality: text
risk_notes: []
acceptance_criteria: []
approval_required: true
recipe:
  dataset_path: "D:/workspace/input.jsonl"
  export_path: processed.jsonl
  process: []
  executor_type: default
  np: 4
postprocess: []
```

Use only real operator names and parameters returned by capability discovery. Scripts must exist inside the workspace before `prepare_plan`; the MCP snapshots them into the immutable bundle. Never put plaintext secrets in a plan, recipe, script arguments, report, or tool call.

For API operators, omit `api_key` and `base_url` from the plan. Data-Juicer inherits credentials and endpoints from the MCP server environment. For an API-backed VLM operator, set `is_api_model: true` and normally omit `api_or_hf_model`; `prepare_plan` materializes the server default reported by `runtime.default_models.vlm`. Treat that declared role as authoritative: never infer modality from substrings such as `vl`, never replace the configured model on your own, and never read an environment file. An explicit user-selected model may override the default and must be shown as a material plan parameter. If required runtime configuration is absent, report the missing capability and ask the user to reconfigure and restart the MCP server without inspecting secret files.

## Tool Surface

- Inspect: `inspect_input`
- Discover: `search_capabilities`
- Version: `prepare_plan`, `get_plan`
- Review: `preview_plan`
- Gate: `approve_plan`
- Execute: `run_plan`, `get_run`, `cancel_run`

Do not use legacy `run_data_recipe`, DJAgent, `djx`, or direct data-mutating shell commands to bypass this lifecycle.
