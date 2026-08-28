---
name: data-juicer-plan-flow
description: Plan, approve, execute, and recover reproducible Data-Juicer cleaning tasks through the mcp__dj__ plan-flow tools. Use for formal data processing that needs clarification, review, versioned plans, or reports.
user-invocable: true
disable-model-invocation: true
---

# Data-Juicer Plan Flow

Use one DSH agent. The MCP is a capability, persistence, and execution layer; it is not another agent. Use the workspace selected by the user, and pass its absolute path as `workspace_root` on every workspace-scoped call.

The MCP server has no independent business workspace. Its source directory and process cwd are implementation details and must never be used as `workspace_root`. Obtain the current workspace from the DSH session and pass its absolute path on every workspace-scoped call. Resolve every relative user path from that root. Do not ask the user to copy workspace data into the MCP source tree or request elevated access to it.

## Workflow

1. Before clarifying requirements or creating a pipeline, build a concise Draft TaskSpec covering input, output, scale, categories and distribution, hard constraints, soft preferences, semantic boundaries, acceptance criteria, optimization objectives, and execution capabilities; classify unknowns as `unknown_discoverable` or `unresolved_user_owned`. A TaskSpec is decision state, not a questionnaire or a checklist that must be narrated field by field; do not recite empty fields to the user. Read [TaskSpec and requirements clarification](references/task-spec-and-clarification.md) only when its detailed schema is needed or the request contains numeric, hard/soft, or complex semantic ambiguity.
2. Resolve only `unresolved_user_owned` Material Ambiguities that block input inspection or capability discovery. Ask 1–3 high-impact questions per round when practical. If one question already blocks the next stage, ask only that question and defer later planning, implementation, and acceptance questions. When `ask_user_question` is available, use it; otherwise ask a concise plain-text question. Do not ask for facts obtainable through data inspection, capability discovery, or environment probing, and do not ask merely because a TaskSpec field is empty. Do not call `inspect_input` or `search_capabilities` until the TaskSpec is `discovery_ready`.
3. Once `discovery_ready`, call `mcp__dj__inspect_input` for local input, merge overlapping business judgments into a small set of atomic requirements, normalize them as concise English capability queries, and submit all of them in one `mcp__dj__search_capabilities` batch. Plan-flow discovery uses server-side BM25 over the existing DJ operator registry, not regex; exact operator names use the server's deterministic lookup. Allow at most one normal search round per confirmed TaskSpec version. Feed the results back into the TaskSpec. Use only the returned `runtime` object to learn server configuration. Never read or inspect an environment file through DSH tools.
4. Discovery may expose new Material Ambiguities. Clarify only remaining user-owned choices that would materially change the pipeline. Detection approach, operator capability, and execution environment are discovery findings; do not ask the user to choose them before discovery. Ask only when they require new permission, cost, or a user-owned business tradeoff. Once the TaskSpec is `plan_ready`, present its structured requirements summary and acceptance criteria, then request `Confirm and plan`, `Revise requirements`, or `Cancel`. Use `ask_user_question` when available and plain text otherwise. Continue only when the user explicitly selects `Confirm and plan`; the original request itself is not confirmation.
5. Capability search returns compact, cross-requirement-deduplicated definitions from DJ's existing `OPRecord/OPSearcher` catalog. Batch-load full schemas for shortlisted or selected names with `mcp__dj__get_capability_schemas` before declaring an operator suitable or writing it into `plan.recipe.process`. Loading a known candidate's schema is not another search, and a real pipeline may select more than five operators. If all candidates fail schema validation, record the gap; allow one targeted corrective search only after the user changes the TaskSpec or there is evidence of a recall anomaly. Otherwise propose a generic Python artifact in top-level `plan.postprocess`; do not search indefinitely. Never place postprocess configuration inside `recipe`.
6. Call `mcp__dj__prepare_plan`. For a revision, reuse its `task_id` and pass the prior `plan_version` as `base_plan_version`. Every call creates a new immutable `plan_vNNN`; never edit an existing plan bundle.
7. Present the normalized recipe, important parameters, postprocess steps, risks, validation findings, version diff, and `content_hash`. Then request `Approve and run`, `Revise plan`, or `Cancel`. Use `ask_user_question` when available and plain text otherwise. Call `mcp__dj__approve_plan` only when the user explicitly selects `Approve and run`; a general acknowledgement is not approval. A revised plan requires a new review.
8. After approval, call `mcp__dj__approve_plan` with the exact `task_id`, `plan_version`, and `content_hash`, then call `mcp__dj__run_plan`.
9. Poll `mcp__dj__get_run`. On failure, inspect its logs first. Retry unchanged transient failures only when safe. If recipe, artifacts, paths, or semantics must change, prepare a new version and obtain approval again. Use `mcp__dj__cancel_run` only when requested or continuing is unsafe.
10. On success, return the task id, plan version, run id, output directory, materialized recipe, and report path.

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
- Load discovered definitions: `get_capability_schemas`
- Version: `prepare_plan`, `get_plan`
- Review: `preview_plan`
- Gate: `approve_plan`
- Execute: `run_plan`, `get_run`, `cancel_run`

Do not use legacy `run_data_recipe`, DJAgent, `djx`, or direct data-mutating shell commands to bypass this lifecycle.
