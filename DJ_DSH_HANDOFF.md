# Data-Juicer + DeepSeek Harness Plan-Flow Handoff

Last updated: 2026-08-23

The detailed and canonical handoff is [DJ_DSH_HANDOFF.zh-CN.md](./DJ_DSH_HANDOFF.zh-CN.md). Read it before changing code. This English file is an operational summary and must not be used to restore the obsolete recipe-flow design.

## Objective and architecture

The system deliberately removes the DJAgent dependency. It uses one DSH agent plus Data-Juicer and a small `plan-flow` MCP. DSH owns reasoning, clarification, operator/script allocation, and user interaction. MCP is a non-agent capability, validation, persistence, and execution layer.

The workflow is:

1. resolve material ambiguity with `ask_user_question`;
2. summarize even a complete request and obtain UI confirmation before planning;
3. inspect input and search the DJ operator catalog;
4. place supported work in `plan.recipe.process` and genuine gaps in top-level `plan.postprocess` as reviewed Python artifacts;
5. save immutable `plan_vNNN` bundles;
6. display the normalized Plan, important parameters, validation, diff, risks, and `content_hash`;
7. obtain a second UI approval before `approve_plan` and `run_plan`;
8. run asynchronously and retain the materialized recipe, logs, outputs, and report;
9. create and re-approve a new Plan version for every material change.

MCP is not a second agent. The former `build_dataset_spec`, `build_process_spec`, and `build_system_spec` split is unnecessary for this single-agent design.

## Current locations

```text
D:\dj\data-juicer-1.5.4     Data-Juicer source and plan-flow implementation
D:\dj\.envs\dsh-dj         Python used by MCP
D:\dsh-app                  DSH launcher, patch, Skills, env configuration, docs
<DSH session workspace>      Per-session data, plans, artifacts, runs, outputs
```

Never hard-code a historical workspace. The DJ source directory and MCP cwd are implementation details, not the business workspace.

Core implementation:

```text
D:\dj\data-juicer-1.5.4\data_juicer\tools\plan_flow\
D:\dj\data-juicer-1.5.4\data_juicer\tools\DJ_mcp_plan_flow.py
D:\dj\data-juicer-1.5.4\data_juicer\tools\mcp_server.py
D:\dsh-app\.dsh\skills\data-juicer-plan-flow-zh\SKILL.md
D:\dsh-app\.dsh\skills\data-juicer-plan-flow\SKILL.md
D:\dsh-app\web-dj.ps1
D:\dsh-app\dj-dsh.patch.yml
```

The user edited the Chinese Skill. Preserve those edits.

## MCP surface

Exactly nine formal tools are exposed:

```text
inspect_input
search_capabilities
prepare_plan
get_plan
preview_plan
approve_plan
run_plan
get_run
cancel_run
```

The old `run_data_recipe`, DJAgent, `djx`, and direct mutation through shell are not part of the formal workflow.

## Workspace and persistence

The installed DSH MCP client does not implement MCP Roots. Every workspace-scoped tool therefore requires the absolute `workspace_root` selected in the current DSH session. Relative paths resolve from that root and may not escape it. Do not add a server-global `set_workspace`; a shared HTTP MCP could leak state across sessions.

Persistent layout:

```text
<workspace>\.dj\inputs\...
<workspace>\.dj\tasks\task_<id>\plans\plan_vNNN\...
<workspace>\.dj\tasks\task_<id>\runs\run_rNNN\...
<workspace>\outputs\<task-slug>\plan_vNNN\run_rNNN\...
```

Each Plan bundle stores `plan.yaml`, validation, diff, one content hash, approval state, and copied artifact hashes. Invalid plans remain auditable but cannot be approved. Any Plan or artifact mutation fails bundle verification. Runs re-check the approved hash and always get a unique output directory.

## API and VLM configuration

`D:\dsh-app\web-dj.ps1` reads `D:\dsh-app\dj-plan-flow.env` at MCP startup and injects an allowlisted environment snapshot. Runner children inherit it. Operators and DSH must never read the env file directly, and secrets must never enter a Plan, tool call, log, report, or document.

`runtime` exposes only safe readiness booleans plus the non-secret server VLM declaration:

```json
{
  "default_models": {
    "vlm": {
      "configured": true,
      "model": "qwen3.7-plus",
      "role": "vision-language",
      "source": "server_environment"
    }
  }
}
```

Do not infer modality from model-name substrings or replace the configured model. `qwen3.7-plus` supports image input despite lacking `vl` in its name. For an API-backed VLM operator, use `is_api_model: true` and normally omit `api_or_hf_model`; `prepare_plan` materializes `DJ_VLM_MODEL`. An explicit user-selected model may override it and must be reviewed.

Changing the env file requires an MCP restart. If port 8010 is already occupied, the launcher reuses the existing process and warns that the env was not reloaded.

## Operator search fixes

Media modality filtering now treats multimodal operators as compatible:

```text
image -> image OR multimodal
video -> video OR multimodal
audio -> audio OR multimodal
```

An exact operator-name query is returned first without being silently removed by BM25 or tag filtering. Candidates include `modality_compatible` and `executor_compatible`.

This fixes `image_tagging_vlm_mapper`, whose tags are `gpu, api, vllm, multimodal`; the old `modality=image` filter excluded it before ranking.

## Interaction and approval boundary

The Skill mandates two explicit `ask_user_question` calls: requirement confirmation and exact Plan approval. A plain chat acknowledgement and the original request are not approval.

The MCP content hash guarantees integrity and binds approval to one bundle. It does not prove that a human UI answer caused `approve_plan`. If non-bypassable human provenance is required, implement a small DSH-side approval bridge that calls `ctx.userQuestions.ask()` and then approves; this is a tool adapter, not another agent.

## Run and restart

MCP endpoint:

```text
http://127.0.0.1:8010/mcp
```

Start:

```powershell
& D:\dsh-app\web-dj.ps1
```

Before stopping port 8010, inspect the owning command line and stop it only if it matches `data_juicer.tools.mcp_server ... plan-flow`. The full safe command is in the Chinese handoff.

Restart MCP after Python code, dependency, or env changes. Restart DSH or open a new session after Skill changes. Never restart during a real run.

## Verification status

Tests cover dynamic workspace resolution, secret-safe runtime status, VLM default materialization, exact and multimodal search, immutable Plan versions and diffs, invalid-plan rejection, approval/tamper gates, postprocess snapshots, the nine-tool surface, and a full approved DJ run with a report.

Latest results: 10 fast tests passed; the full execution test passed separately. Known non-blocking warnings are Pydantic Settings' incomplete forward reference and existing invalid Python escape-sequence warnings.

## Current state and next steps

Plan-flow is implemented; this is no longer an Option B design discussion. At handoff time, both repositories contain uncommitted changes. Run `git status --short` in both `D:\dsh-app` and `D:\dj\data-juicer-1.5.4` before work.

Next:

1. restart the old MCP on 8010 and restart DSH;
2. use a new session for a small real end-to-end task;
3. verify both UI confirmations, dynamic workspace storage, operator search, Plan persistence, approval, execution, and report;
4. verify DSH never reads `.env` or substitutes the VLM;
5. test `plan_v001 -> plan_v002` and re-approval;
6. test failure diagnosis and safe recovery;
7. enrich reports with input/output counts, filtering rates, key statistics, and acceptance-criterion results;
8. decide whether a hard DSH approval bridge is needed;
9. review and commit both repositories after acceptance.

## Do not repeat these mistakes

- Do not hard-code a workspace or use MCP cwd as the workspace.
- Do not add server-global mutable workspace state.
- Do not read `.env` through DSH or operator code.
- Do not expose secrets in artifacts or logs.
- Do not treat missing runtime fields as permission to inspect config; restart the old MCP.
- Do not infer model capability from its name or silently replace it.
- Do not treat `content_hash` as human provenance.
- Do not accept vague chat text as Plan approval.
- Do not overwrite Plan versions or put postprocess inside DJ recipe.
- Do not search indefinitely for a nonexistent operator; represent a real gap explicitly.
- Do not assume an exact-name miss means an operator is absent; inspect tag compatibility.
- Do not use stdio MCP interactively or paste JSON/YAML config into PowerShell.
- Do not launch DJ with base Python or assume a source edit changed another installed package.
- Do not assume a listening 8010 process loaded new code or env.
- Do not restart during a run or overwrite the user's Chinese Skill edits.
- Do not hard-code a demonstration task into generic behavior.
