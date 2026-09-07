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
3. Once `discovery_ready`, call `mcp__dj__inspect_input` for local input, merge overlapping business judgments into a small set of atomic requirements, normalize them as concise English capability queries, and submit all of them in one initial `mcp__dj__search_capabilities` batch. Plan-flow discovery uses server-side BM25 over the existing DJ operator registry, not regex; exact operator names use the server's deterministic lookup, and each requirement returns at most three ranked candidates. Allow one initial search batch per confirmed TaskSpec version and do not retry with aimless paraphrases; the single gap-only atomic retry required by step 5 is not a repeated normal search. Feed the results back into the TaskSpec. Use only the returned `runtime` object to learn server configuration. Never read or inspect an environment file through DSH tools.
4. Discovery may expose new Material Ambiguities. Clarify only remaining user-owned choices that would materially change the pipeline. Detection approach, operator capability, and execution environment are discovery findings; do not ask the user to choose them before discovery. Ask only when they require new permission, cost, or a user-owned business tradeoff. Once the TaskSpec is `plan_ready`, present its structured requirements summary and acceptance criteria, then request `Confirm and plan`, `Revise requirements`, or `Cancel`. Use `ask_user_question` when available and plain text otherwise. Continue only when the user explicitly selects `Confirm and plan`; the original request itself is not confirmation.
5. Discovery combines the DJ built-in and current account's personal catalogs. Inspect all Top 3 descriptions returned for each atomic requirement, then choose a minimum-sufficient shortlist: take Top 1 when it is high-scoring and clearly complete; take Top 2–3 when candidates cover different parts, scores are close, descriptions cannot prove complete coverage, or semantics are ambiguous. Do not fix the policy at Top 1 merely to save work, and do not mechanically load all Top 3 without a selection reason. If none completely covers a query that combines multiple behaviors, metrics, or outputs, split it into narrower Atomic Requirements and perform exactly one gap-only `search_capabilities` retry for the uncovered requirements. Only after that retry still fails may the Agent declare a capability gap. Load executable parameter contracts only for the selected shortlist in one batched `get_capability_schemas` call; search owns descriptions and tags, while schemas do not repeat them. If no candidate fits after the required retry, or comparison evidence shows DJ quality is insufficient, call `get_custom_operator_authoring_spec` once with the required category and modality; never call it before the gap retry is complete. Start from its `source_scaffold`, and obey its running DJ version, base class, registration, required methods, forbidden overrides, and `model_policy`. Choose exactly one model strategy: `none`, `api_vlm`, `remote_model`, or `local_model`. Prefer a matching DJ built-in, then a lightweight deterministic implementation. For `remote_model`, declare an immutable `model_id` and commit `revision` in `model_refs` and load that exact revision; for `local_model`, declare an existing absolute file; for extra Python packages, provide exact `name==version` pins. API VLM uses private backend configuration and must not embed secrets. Models use backend caches and never belong in `assets` or test directories. Ask before a paid API, private/gated model, or large download. Otherwise fill the scaffold and immediately call `develop_custom_operator`; do not continue researching alternative interfaces or architectures. Submit the separately named operator with source, frozen validation_contract, temporary samples and parameters. On `OPERATOR_SOURCE_INCOMPATIBLE`, revise only from `source_preflight.diagnostics`, at most twice; never search the whole filesystem, Python environments, DJ source checkout, or the web for interface conventions. Poll `get_custom_operator_job` only while status is testing, and stop immediately on failed/cancelled while reporting `error_details.phase`; cancel=true requests cleanup. Do not create postprocess scripts or business output directories before the operator succeeds. Passing declared assertions publishes to the personal catalog automatically; smoke-only is experimental, not quality approval. Never weaken the frozen contract or edit DJ source. Bind personal candidates in plan.operator_bindings using step_index, provider=user, operator_id and version; do not provide user IDs or custom_operator_paths. Business Plan approval remains mandatory. This deployment uses native LocalProcessBackend, not Docker or broker.
6. Call `mcp__dj__prepare_plan`. For a revision, reuse its `task_id` and pass the prior `plan_version` as `base_plan_version`. Every call creates a new immutable `plan_vNNN`; never edit an existing plan bundle.
7. `prepare_plan` returns the normalized Plan together with `execution_preview` and `runtime_assessment`. Present the recipe, important parameters, postprocess steps, risks, validation findings, resolved backend and devices, CPU/GPU fallbacks or blockers, version diff, and `content_hash`. Do not request execution approval while `runtime_assessment.blocking_issues` is non-empty. Otherwise request `Approve and run`, `Revise plan`, or `Cancel`. Use `ask_user_question` when available and plain text otherwise. Call `mcp__dj__approve_plan` only when the user explicitly selects `Approve and run`; a general acknowledgement is not approval. A revised plan requires a new review.
8. After approval, call `mcp__dj__approve_plan` with the exact `task_id`, `plan_version`, and `content_hash`, then call `mcp__dj__run_plan`.
9. Poll `mcp__dj__get_run`. On failure, inspect its logs first. Retry unchanged transient failures only when safe. If recipe, artifacts, paths, or semantics must change, prepare a new version and obtain approval again. Use `mcp__dj__cancel_run` only when requested or continuing is unsafe.
10. On success, return the task id, plan version, run id, output directory, materialized recipe, and report path.

`mcp__dj__get_plan` includes the non-executing `execution_preview` and the current environment's `runtime_assessment`. They do not replace validation or approval, and `run_plan` repeats the runtime preflight before execution.

## Interaction Presentation Contract

When a user decision is required, separate the review material from the decision control:

- First present the complete requirements summary, proposal, capability evidence or gap, Plan, diff, risks, and acceptance mapping in an ordinary assistant response.
- Then call `ask_user_question`. Its `question` must be one short sentence stating only the decision the user must make; do not copy the report, Plan, evidence list, or Markdown sections into the popup.
- Keep option labels short. Each option description may contain at most one sentence explaining the direct impact or tradeoff. The question may include a task id, plan version, or `content_hash` when needed to bind an approval to the exact artifact.
- Do not call `ask_user_question` when no user choice is required.

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

For API operators, omit `api_key` and `base_url` from the plan. Data-Juicer inherits credentials and endpoints from the MCP server environment. Capability discovery never exposes runtime configuration. For an API-backed VLM operator, set `is_api_model: true` and normally omit `api_or_hf_model`; only after that operator is selected does `prepare_plan` privately resolve the server default and materialize its non-secret model name in the normalized Plan. An explicit user-selected model may override the default and must be shown as a material plan parameter. If the selected operator lacks credentials or a default model, show the operator-specific validation error and configuration guidance, then stop before approval without inspecting secret files.

## Tool Surface

- Inspect: `inspect_input`
- Discover: `search_capabilities`
- Load discovered definitions: `get_capability_schemas`
- Load the running DJ authoring contract: `get_custom_operator_authoring_spec`
- Develop/test personal operators: `develop_custom_operator`, `validate_custom_operator`, `get_custom_operator_job`
- Version, review, and runtime preflight: `prepare_plan`, `get_plan`
- Gate: `approve_plan`
- Execute: `run_plan`, `get_run`, `cancel_run`

Do not use legacy `run_data_recipe`, DJAgent, `djx`, or direct data-mutating shell commands to bypass this lifecycle.
