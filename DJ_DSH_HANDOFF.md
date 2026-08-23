# Data-Juicer + DSH Handoff

## Objective

Integrate Data-Juicer (DJ) into DeepSeek Harness (DSH) on Windows so a model can:

1. inspect and analyze data first;
2. propose a processing pipeline and wait for explicit user approval;
3. save an auditable, reproducible recipe;
4. validate and execute that exact recipe;
5. verify outputs.

The next design task is to replace or extend DJ's bundled MCP workflow with a plan-first MCP interface. Do not expose every DJ operator by default.

## Directory Roles

```text
D:\dsh-app  DSH app shell, DSH patch, launcher, DSH-compatible skills
D:\dj       Data-Juicer installation and Python virtual environment
D:\shishi   User-selected DSH data workspace
```

Keep these roles separate. DJ dependencies may remain in `D:\dj`; input data, outputs, plans, and temporary runtime state must remain in the current user workspace, currently `D:\shishi`.

## Current Runtime State

The DJ DSH Web UI is normally served at:

```text
http://127.0.0.1:49429/
```

The bundled DJ `recipe-flow` MCP server is configured at:

```text
http://127.0.0.1:8000/mcp
```

`D:\dsh-app\web-dj.cmd` invokes `web-dj.ps1`. The PowerShell launcher:

- starts the DJ MCP server if port 8000 is not already listening;
- starts DSH with `D:\dsh-app\dj-dsh.patch.yml`;
- starts the MCP Python process with `TEMP`, `TMP`, and `TMPDIR` set to `D:\shishi\.dj\tmp`;
- serves DSH on a requested port, usually 49429.

Important: stopping/restarting the launcher interrupts in-flight MCP calls. Previous restarts interrupted at least one real `run_data_recipe` call, so outputs must be inspected rather than assumed complete.

## What Is Installed and Working

### Data-Juicer

- Repository: `D:\dj\data-juicer-agents`
- Python: `D:\dj\data-juicer-agents\.venv\Scripts\python.exe`
- CLI: `D:\dj\data-juicer-agents\.venv\Scripts\djx.exe`
- `djx tool list` works after installing `py-data-juicer` into the virtual environment.
- `retrieve_operators` was tested successfully against the local operator catalog.

Avoid installing the local `D:\dj\data-juicer-1.5.4` project editable unless the machine has required native build tools. The working runtime is the virtualenv-installed package.

### DSH Skills

Ten DSH-compatible DJ skills live under:

```text
D:\dsh-app\.dsh\skills
```

The main skill is:

```text
D:\dsh-app\.dsh\skills\data-juicer\SKILL.md
```

Skills use kebab-case names because DSH rejects underscore names. `prepare-dj-skills.ps1` regenerates all ten skills from the CoPAW source, converts source text to ASCII to avoid encoding corruption, renames skill references, and reapplies local guidance.

The main skill contains an approval gate:

- analysis and operator search can proceed without approval;
- before writing a plan or changing data, the model must show paths, operators, parameters, effects, trade-offs, validation, and timeout;
- vague acknowledgements such as `ok` or `continue`, CLI `--yes`, and a tool argument `confirm: true` are not human approval;
- an explicit later approval is required;
- changed paths or material parameters require approval again.

The main skill currently says to prefer `mcp__dj__*` tools when present, with CLI fallback. This preference needs revisiting after plan-first MCP design is implemented.

### Current DSH Patch

File:

```text
D:\dsh-app\dj-dsh.patch.yml
```

It enables skill discovery, skill invocation, PowerShell, filesystem, search, jobs, and inserts one MCP client instance:

```yaml
- insert:
    - id: mcp-dj
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: dj
        transport: streamable-http
        url: http://127.0.0.1:8000/mcp
        toolCallTimeoutMs: 1800000
        failOnStartupError: true
```

Use `- insert:` for a new DSH plugin entry. A plain `- id: mcp-dj` patch fails because patch entries can only override existing rows.

### Current Bundled Recipe-Flow MCP

DSH successfully connects to the MCP endpoint and discovers these five tools:

```text
mcp__dj__get_global_config_schema
mcp__dj__get_dataset_load_strategies
mcp__dj__search_ops
mcp__dj__run_data_recipe
mcp__dj__analyze_dataset
```

Relevant files used by the running virtualenv:

```text
D:\dj\data-juicer-agents\.venv\Lib\site-packages\data_juicer\tools\mcp_server.py
D:\dj\data-juicer-agents\.venv\Lib\site-packages\data_juicer\tools\DJ_mcp_recipe_flow.py
D:\dj\data-juicer-agents\.venv\Lib\site-packages\data_juicer\tools\DJ_mcp_granular_ops.py
D:\dj\data-juicer-agents\.venv\Lib\site-packages\data_juicer\tools\mcp_tool.py
```

There is also a source checkout under `D:\dj\data-juicer-1.5.4`, but its MCP files have different hashes and are not the files imported by the active virtualenv.

## Important Findings

### Recipe-Flow Is Not a Persistent Recipe Workflow

`run_data_recipe` creates an in-memory dictionary with `dataset_path`, `process`, `export_path`, `np`, and optional `extra_config`, then immediately calls `execute_op`.

It does not:

- create a plan ID;
- save YAML or JSON recipe artifacts;
- provide a dry-run tool;
- produce an execution manifest or reproducible resolved configuration;
- require a human approval token.

It returns a result path only. DSH tool history may contain arguments, and server logs may print a config, but neither is an auditable recipe artifact. Therefore bundled `recipe-flow` is acceptable for experimentation but not for formal, reproducible processing.

### Granular-Operators Does Not Build a Pipeline

`granular-ops` dynamically exposes operators as individual MCP tools. Each call builds a one-operator `process` list and immediately calls `execute_op`.

It does not accumulate multiple calls into one pipeline or save a composed recipe. It also can expose a very large tool catalog. `DJ_OPS_LIST_PATH` can limit exposed operators, which is useful for a tightly curated experimental toolset, but it does not solve reproducibility.

Use granular mode for targeted single-operator tests, not as the primary pipeline orchestration interface.

### Windows Temporary File Failure Was Fixed

Original failure:

```text
PermissionError: [Errno 13] Permission denied: ...job_dj_config_....json
```

The temporary directory setting was working; the file path was under `D:\shishi\.dj\tmp`.

Actual root cause: `get_init_configs()` used `tempfile.NamedTemporaryFile(delete=True)` and then passed the still-open file to `jsonargparse`, which tried to reopen it. Windows prevents that second open because of the file handle lock.

Patched active runtime file:

```text
D:\dj\data-juicer-agents\.venv\Lib\site-packages\data_juicer\config\config.py
```

The patch uses `delete=False`, closes the file, calls `init_configs`, then deletes the temp path in `finally`. A direct `get_init_configs()` smoke test returned `CONFIG_OK` after the patch.

This is a virtualenv site-package edit. Reinstalling or upgrading `py-data-juicer` may overwrite it. A durable solution should carry this patch in a controlled local overlay or upstream it.

## Recommended Next Architecture: Plan-First MCP

Do not keep extending `run_data_recipe` as a one-shot execution tool. Add a separate MCP mode or local adapter, for example `plan-flow`, with a small, explicit interface:

```text
analyze_dataset
search_ops
prepare_recipe
save_recipe
validate_recipe
run_recipe
inspect_output
```

Recommended behavior:

1. `prepare_recipe` accepts discovered operators and intent, normalizes ordering and parameters, returns a canonical recipe object plus a content hash, and does not write data.
2. `save_recipe` writes a YAML artifact under the active workspace, for example `D:\shishi\.dj\plans\<name>.yaml`.
3. `validate_recipe` loads and validates the exact saved YAML without processing data.
4. `run_recipe` accepts only a saved recipe path and an explicit confirmation argument. It records an execution manifest containing recipe hash, DJ version, start/end time, input/output paths, and result statistics.
5. `inspect_output` reports output profile and links it to the execution manifest.

The existing `djx` harness already models much of this sequence with `inspect_dataset`, `retrieve_operators`, `build_*`, `assemble_plan`, `plan_save`, and `apply_recipe`. The best custom MCP can expose these plan-oriented capabilities rather than inventing a second incompatible recipe format.

## Design Options to Discuss

### Option A: Modify Bundled Recipe-Flow In Place

Add `prepare_recipe`, `save_recipe`, `validate_recipe`, and `run_recipe` to `DJ_mcp_recipe_flow.py`; update `mcp_server.py` to choose a new mode or extend `recipe-flow`.

Pros:

- fastest route;
- reuses current server and tool discovery.

Cons:

- patches a virtualenv package and is overwritten by upgrade;
- mixes local policy and upstream code;
- requires careful design to avoid an unbounded MCP tool surface.

### Option B: Add a Local Plan-Flow MCP Adapter

Create a separately versioned local module outside the virtualenv package, for example under `D:\dsh-app` or a dedicated local extension directory. It can invoke the existing `djx` plan tools or DJ Python APIs while preserving a stable plan-first interface.

Pros:

- update-safe and locally owned;
- clean seam between DSH and DJ;
- can persist approval state and manifests explicitly;
- easiest to test independently.

Cons:

- more initial implementation work.

Recommendation: Option B. It is the better long-term interface for an audited workflow.

### Option C: Keep CLI for Execution, MCP for Analysis

Use existing `recipe-flow` MCP only for `analyze_dataset` and `search_ops`; retain `djx plan_save + apply_recipe` for formal execution.

Pros:

- immediately reproducible;
- no new adapter work.

Cons:

- two execution surfaces;
- model must choose correctly;
- less elegant than a unified plan-first MCP.

Use this as the safe interim mode while Option B is designed.

## Repeated Pitfalls to Avoid

1. Do not confuse the DJ install directory with the selected DSH data workspace.
2. Do not launch a second DSH server on an occupied port; use a stable port or explicitly select a new one.
3. Do not restart MCP/DSH while a real recipe call is running.
4. Do not use system Temp for workspace-write processing; use a workspace-local temp directory.
5. Do not assume a writable directory eliminates all `PermissionError` cases; Windows `NamedTemporaryFile` locking was the actual issue here.
6. Do not put secret model keys or raw sensitive data in MCP server logs, recipes, or handoff documents.
7. Do not rely on MCP logs or model tool-history as a reproducibility artifact.
8. Do not expose all granular operators unless a curated list is intentional.
9. Do not edit the source checkout and expect the active virtualenv package to change; verify the import path first.
10. DSH skill names must be kebab-case, not underscore_case.
11. Preserve the approval gate even after moving execution from CLI to MCP.
12. The DSH patch uses `- insert:` to add new plugins; id-only patch rows are only for existing plugin entries.

## Suggested First Prompt for the Next Conversation

```text
Read D:\dsh-app\DJ_DSH_HANDOFF.md. Design an Option B local plan-first MCP adapter for Data-Juicer and DSH. Keep the MCP interface small: analyze, search, prepare, save, validate, run, inspect output. The adapter must produce a canonical YAML recipe and an execution manifest, enforce an explicit approval boundary before run, work with D:\shishi as the active workspace, and avoid logging secrets. Do not modify files until presenting the design and trade-offs.
```
