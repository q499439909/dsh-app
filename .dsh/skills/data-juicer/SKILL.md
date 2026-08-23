---
name: data-juicer
description: >-
  Full data processing harness based on Data-Juicer for cleaning, filtering, deduplicating, and transforming JSONL/JSON datasets.
  Trigger keywords: data cleaning, data filtering, deduplication, dedup, dataset, dataset processing, JSONL processing,
  text cleaning, HTML cleaning, low-quality filtering, data preprocessing, ETL, data pipeline.
  Error triggers: dj-process failure, operator not found, plan validation failure, recipe execution timeout,
  OOM, permission denied, apply_recipe error.
  Related skills: djx-install (installation), djx-auth (authentication), djx-local-model (private data),
  djx-context (dataset inspection), djx-retrieve (operator search), djx-plan (plan building),
  djx-apply (execution), djx-dev (custom operators).
  Note: Simple statistics (wc -l, head) do not require this skill - use shell commands directly.
allowed-tools: Bash, Read
argument-hint: "<input_path> <output_path>"
user-invocable: true
auto_load: true
---

# Data-Juicer Data Processing Harness

Clean, filter, deduplicate, and transform JSONL/JSON datasets via the `D:\dj\data-juicer-agents\.venv\Scripts\djx.exe tool` CLI when bare `djx` is not on PATH.

> **Data-Juicer Agents**: If not yet installed, visit [data-juicer-agents](https://github.com/data-juicer/data-juicer-agents) for installation instructions.

---

## Approval Gate: Analyze First, Then Wait

Default to **analysis only**. First inspect the dataset, retrieve and evaluate operators, and build the proposed recipe in memory. These read-only planning actions are permitted without a confirmation.

Before any operation that writes a plan or changes data, stop and present a concise proposal containing the input and output paths, selected operators and parameters, expected effect and key trade-offs, and proposed validation and timeout. Then wait for a later, explicit user message such as `confirm execution of this proposal`.

Do **not** treat the original request, a vague acknowledgement such as `ok` or `continue`, the CLI `--yes` flag, or the `confirm: true` tool parameter as user authorization. Do not call `plan_save`, `apply_recipe` without `dry_run: true`, file-writing tools, or data-mutating shell/Python commands before that explicit approval. If the recipe, paths, or material parameters change after approval, present the revised proposal and ask again.

After explicit approval: save the plan, run a dry run, then run the recipe. Report output verification when complete.

## Plan-First MCP Workflow

When the `mcp__dj__create_job` and `mcp__dj__prepare_plan` tools are available, they are the required path for formal Data-Juicer tasks. Do not call the legacy `mcp__dj__run_data_recipe` for a formal task.

1. Call `create_job` with the DSH-selected workspace root and a proposed title/task slug.
2. Use `scan_media_folder` for image/video directories; use `analyze_dataset`, `search_ops`, `get_global_config_schema`, and `get_dataset_load_strategies` only for discovery.
3. Call `prepare_plan`, then `validate_plan`; optionally call `preview_plan` for a small JSONL sample.
4. Show the pipeline, paths, important parameters, warnings, plan hash, and compiled recipe summary. Wait for a later explicit confirmation.
5. Only after that confirmation call `approve_plan`, then `run_recipe` with the returned plan version.
6. Poll `get_run_status`, fetch `get_run_result`, and report the generated `outputs/<task-slug>/vNNN/report.md`.

The MCP is the enforcement layer: an unapproved plan must not run. Use the CLI only when the plan-first MCP is unavailable or a capability is deliberately outside its scope.

### API VLM Configuration

Keep API keys and provider base URLs out of plans, recipes, reports, and chat output. The plan-flow MCP reads its service configuration from `D:\dsh-app\dj-plan-flow.env`; `dj-plan-flow.env.example` documents the supported variables.

For an API VLM step, set `is_api_model: true`. When the user does not name a model, set `api_or_hf_model` to `${DJ_VLM_MODEL}`; prepare_plan resolves that non-secret reference before recipe hashing. An explicitly requested model is written directly and is never overridden. For DashScope-compatible Qwen models, omit `api_endpoint`; Data-Juicer then uses `/chat/completions`, while `OPENAI_BASE_URL` and an API key come from the service environment. `validate_plan` rejects a full provider URL in `api_endpoint` and reports missing service credentials before any run.

When a later stage must consume `image_tagging_vlm_mapper` tags, set `keep_stats_in_res_ds: true` in `extra_config`; otherwise Data-Juicer removes `__dj__meta__` from the exported JSONL. Treat an `INCOMPLETE_VLM_TAGS` preview warning as a failed preview and do not approve the full run.
---

## Prerequisites

| Condition | Requirement | Verification Command |
|-----------|-------------|---------------------|
| **Installation** | `data-juicer-agents` installed | `djx tool list` |
| **Authentication** | `DASHSCOPE_API_KEY` set (LLM mode) | `echo $DASHSCOPE_API_KEY` |
| **Data Format** | JSONL/JSON, UTF-8 encoded | `head -n 1 dataset.jsonl` |
| **Python** | 3.10, 3.11, or 3.12 | `python --version` |

**Conditions not met?**
- Installation issues -> See **djx-install** skill
- Authentication issues -> See **djx-auth** skill
- Private data -> See **djx-local-model** skill (use local models)

---

## Core Concepts

| Concept | Description | Source / How to Determine |
|---------|-------------|--------------------------|
| **dataset_source** | Unified dataset source object; use `{"path": ...}` for a simple local file shortcut | Provided by user; AskUserQuestion if not specified |
| **export_path** | Output dataset path | Default: `<input_dir>/processed/<name>.jsonl`; can ask user |
| **operator** | Data processing unit (mapper/filter/deduplicator) | `retrieve_operators` output; never guess |
| **plan** | Processing plan YAML file | Generated by `assemble_plan` -> `plan_save` |
| **recipe** | Executable processing configuration | Loaded and executed by `apply_recipe` |
| **dataset_profile** | Dataset metadata (fields, statistics, samples) | `inspect_dataset` output |

---

## When to Use This Skill

| Task | Use Data-Juicer? | Alternative |
|------|-------------------|-------------|
| Clean HTML/markup | Yes | - |
| Filter by length/quality/language | Yes | - |
| Deduplicate (exact/approximate) | Yes | - |
| Field transformation/mapping | Yes | - |
| Count dataset lines | No | `wc -l <file>` |
| View first few records | No | `head -n 5 <file>` |
| Merge multiple JSONL files | No | `cat f1.jsonl f2.jsonl > merged.jsonl` |
| Simple field extraction | No | `jq '.field' file.jsonl` |

**Quick decision**: If the task requires operators (filters, mappers, deduplicators) -> use Data-Juicer; if it's a simple shell operation -> use shell directly.

---

## Available Tools

`djx tool list` shows all available tools - **8 in total**:

| Tool | Function | Detailed Reference |
|------|----------|-------------------|
| `inspect_dataset` | Analyze dataset (fields, statistics, samples) | djx-context |
| `retrieve_operators` | Search for suitable operators | djx-retrieve |
| `build_dataset_spec` | Create dataset specification | djx-plan |
| `build_process_spec` | Create operator pipeline specification | djx-plan |
| `build_system_spec` | Create system specification | djx-plan |
| `assemble_plan` | Combine specs into a complete plan | djx-plan |
| `plan_save` | Save plan to YAML | djx-plan |
| `apply_recipe` | Execute the plan | djx-apply |

View any tool's schema:
```bash
djx tool schema <tool_name>
```

> **Note**: `djx tool schema` only works for the 8 tools listed above. It does **not** work for operator names (e.g., `clean_html_mapper`). Operator parameters come from `retrieve_operators` output.

---

## Skill Responsibilities

| Scenario | Skill to Use |
|----------|--------------|
| Installation / environment verification | **djx-install** |
| Configure API Key / model | **djx-auth** |
| Process private data (no cloud sending) | **djx-local-model** |
| View dataset structure / fields | **djx-context** |
| Search for operators | **djx-retrieve** |
| Build plan / spec with detailed parameters | **djx-plan** |
| Execute recipe / timeout / retry | **djx-apply** |
| Develop custom operators | **djx-dev** |
| Execute shell / Python code | **djx-process** |

---

## Scenario 1: Clean and Filter a Dataset

**User intent**: Remove HTML, normalize whitespace, fix encoding, filter short text, deduplicate

### Step Flow

```
inspect_dataset -> retrieve_operators -> build specs -> assemble plan -> apply_recipe -> verify
```

### Step 1: Inspect the Dataset

```bash
djx tool run inspect_dataset --input-json '{"dataset_source": {"path": "/data/articles.jsonl"}, "sample_size": 50}'
```

### Step 2: Retrieve All Needed Operators at Once

**Key**: Combine all requirements into a single intent; do not retrieve in multiple calls.

```bash
djx tool run retrieve_operators --input-json '{
  "intent": "remove HTML tags, normalize whitespace, fix unicode encoding, filter text shorter than 100 characters, deduplicate documents",
  "top_k": 15
}'
```

Select needed operators from the output:
- `clean_html_mapper` - Remove HTML
- `whitespace_normalization_mapper` - Normalize whitespace
- `fix_unicode_mapper` - Fix encoding
- `text_length_filter` - Filter short text
- `document_deduplicator` - Deduplicate

### Steps 3-9: Build Specs and Execute

```bash
# Step 3: Build dataset spec
djx tool run build_dataset_spec --input-json '{
  "intent": "clean HTML, normalize whitespace, fix unicode, filter short, deduplicate",
  "dataset_source": {"path": "/data/articles.jsonl"},
  "export_path": "/data/processed/articles.jsonl",
  "dataset_profile": <STEP_1_OUTPUT>
}'

# Step 4: Build process spec (each operator must have params)
djx tool run build_process_spec --input-json '{
  "operators": [
    {"name": "clean_html_mapper", "params": {}},
    {"name": "whitespace_normalization_mapper", "params": {}},
    {"name": "fix_unicode_mapper", "params": {}},
    {"name": "text_length_filter", "params": {"min_len": 100}},
    {"name": "document_deduplicator", "params": {}}
  ]
}'

# Step 5: Build system spec
djx tool run build_system_spec --input-json '{}'

# Step 6: Assemble plan (intent is required)
djx tool run assemble_plan --input-json '{
  "intent": "clean HTML, normalize whitespace, fix unicode, filter short, deduplicate",
  "dataset_spec": <STEP_3_OUTPUT>,
  "process_spec": <STEP_4_OUTPUT>,
  "system_spec": <STEP_5_OUTPUT>
}'

# Step 7: Save plan (note the parameter names)
djx tool run plan_save --yes --input-json '{
  "plan_payload": <STEP_6_OUTPUT>,
  "output_path": ".djx/plans/clean_filter_dedup.yaml"
}'

# Step 8: Execute (both --yes and confirm:true are required)
djx tool run apply_recipe --yes --input-json '{"plan_path": ".djx/plans/clean_filter_dedup.yaml", "confirm": true, "timeout": 600}'

# Step 9: Verify
djx tool run inspect_dataset --input-json '{"dataset_source": {"path": "/data/processed/articles.jsonl"}, "sample_size": 10}'
```

---

## Scenario 2: Processing Sensitive / Private Data

**User intent**: Data must not be sent to cloud APIs

### Key Configuration

1. **Use local retrieval for operators** (already local, no API needed)
```bash
djx tool run retrieve_operators --input-json '{"intent": "...", "top_k": 15}'
```

2. **Configure local Ollama** (see djx-local-model for details)
```bash
export DJA_OPENAI_BASE_URL="http://localhost:11434/v1"
export DASHSCOPE_API_KEY="ollama"
export DJA_SESSION_MODEL="qwen3.5:0.8b"
```

3. **Verify local mode**
```bash
ollama list
curl http://localhost:11434/v1/models
```

---

## Scenario 3: Developing Custom Operators

**User intent**: Existing operators don't meet requirements; need custom ones

### Pre-check

First search to confirm no existing operator meets the need:
```bash
djx tool run retrieve_operators --input-json '{"intent": "describe the functionality you need"}'
```

### Development Flow

See **djx-dev** skill for details.

```bash
# Generate scaffold
djx tool run develop_operator --yes --input-json '{
  "intent": "extract email addresses and mask them",
  "operator_name": "email_mask_mapper",
  "output_dir": "./custom_operators",
  "smoke_check": true
}'

# Integrate into pipeline
djx tool run build_system_spec --input-json '{"custom_operator_paths": ["./custom_operators"]}'
```

---

## Parameter Quick Reference

### Common Parameter Pitfalls

| Tool | Error-Prone Parameter | Correct Usage | Wrong Usage |
|------|-----------------------|---------------|-------------|
| `build_dataset_spec` | dataset_source.path | `"dataset_source": {"path": "/path/to/data.jsonl"}` | ~~`"input_path"`~~ |
| `build_dataset_spec` | export_path | `"export_path": "/path/to/output.jsonl"` | ~~`"output_path"`~~ |
| `build_process_spec` | operator params | Each operator must have `"params": {}` | Omitting params |
| `text_length_filter` | min_len | `{"min_len": 50}` | ~~`{"min_length": 50}`~~ |
| `build_system_spec` | No intent needed | `{}` | `"intent": "..."` |
| `assemble_plan` | intent required | `"intent": "clean text"` | Omitting intent |
| `plan_save` | plan_payload | `"plan_payload": <full plan object>` | ~~`"plan_id"`~~ |
| `plan_save` | output_path | `"output_path": "plan.yaml"` | ~~`"path"`~~ |
| `apply_recipe` | --yes + confirm | Both are required | Passing only one |

### Command Templates

```bash
# inspect_dataset
djx tool run inspect_dataset --input-json '{"dataset_source": {"path": "<INPUT>"}, "sample_size": 50}'

# retrieve_operators - describe all requirements at once
djx tool run retrieve_operators --input-json '{"intent": "remove HTML, normalize whitespace, fix unicode, filter short text, deduplicate", "top_k": 15}'

# build_dataset_spec
djx tool run build_dataset_spec --input-json '{
  "intent": "<GOAL>",
  "dataset_source": {"path": "<INPUT>"},
  "export_path": "<OUTPUT>",
  "dataset_profile": <INSPECT_OUTPUT>
}'

# build_process_spec - each operator must have params
djx tool run build_process_spec --input-json '{
  "operators": [
    {"name": "<MAPPER>", "params": {}},
    {"name": "<FILTER>", "params": {"min_len": 50}},
    {"name": "<DEDUP>", "params": {}}
  ]
}'

# build_system_spec - pass empty object
djx tool run build_system_spec --input-json '{}'

# assemble_plan - intent is required
djx tool run assemble_plan --input-json '{
  "intent": "<GOAL>",
  "dataset_spec": <DATASET_SPEC>,
  "process_spec": <PROCESS_SPEC>,
  "system_spec": <SYSTEM_SPEC>
}'

# plan_save - note: plan_payload and output_path
djx tool run plan_save --yes --input-json '{
  "plan_payload": <ASSEMBLE_OUTPUT>,
  "output_path": "<PLAN.yaml>"
}'

# apply_recipe - both --yes and confirm:true are required
djx tool run apply_recipe --yes --input-json '{"plan_path": "<PLAN.yaml>", "confirm": true, "timeout": 600}'
```

---

## Must-Read Pitfalls

### 1. Operator Names Must Come from retrieve_operators

**Wrong**: Guessing or memorizing operator names
```bash
djx tool run build_process_spec --input-json '{"operators":[{"name":"clean_html",...}]}'
# -> operator "clean_html" not found
```

**Correct**: Retrieve first, then select from output
```bash
djx tool run retrieve_operators --input-json '{"intent":"clean HTML","top_k":5}'
# -> output contains clean_html_mapper
djx tool run build_process_spec --input-json '{"operators":[{"name":"clean_html_mapper",...}]}'
```

### 2. apply_recipe Requires Both --yes and confirm:true

**Wrong**: Passing only one
```bash
djx tool run apply_recipe --input-json '{"plan_path": "plan.yaml", "confirm": true}'
# -> confirmation_required (exit 3)
```

**Correct**: Pass both
```bash
djx tool run apply_recipe --yes --input-json '{"plan_path": "plan.yaml", "confirm": true, "timeout": 600}'
```

### 3. ray_ Prefixed Operators Require a Ray Cluster

**Avoid** (single-machine environment)
```bash
{"name": "ray_bts_minhash_deduplicator", "params": {}}
```

**Use alternatives** (single-machine friendly)
```bash
{"name": "document_minhash_deduplicator", "params": {}}
{"name": "document_deduplicator", "params": {}}  # Exact deduplication
```

### 4. plan_save Parameter Is output_path, Not path

**Wrong**
```bash
djx tool run plan_save --input-json '{"plan_payload": ..., "path": "plan.yaml"}'
```

**Correct**
```bash
djx tool run plan_save --yes --input-json '{"plan_payload": ..., "output_path": "plan.yaml"}'
```

### 5. retrieve_operators Parameter Is intent, Not query

**Wrong**
```bash
djx tool run retrieve_operators --input-json '{"query": "clean HTML"}'
# -> input_validation_failed
```

**Correct**
```bash
djx tool run retrieve_operators --input-json '{"intent": "clean HTML"}'
```

### 6. Do Not Re-read Previous Output to "Find More Details"

The output of `retrieve_operators` is **already complete**, containing operator name, type, description, and params.

**Wrong behavior**: Repeatedly reading, re-querying, or trying to use `djx tool schema` for operators

**Correct approach**: When params are uncertain, use `{}` to let the operator use default values

---

## Error Recovery

| Error Scenario | Diagnosis | Solution |
|----------------|-----------|----------|
| `confirmation_required` (exit 3) | Missing `--yes` flag | Add `--yes` to the command |
| `confirm=false` no response | Missing `confirm: true` | Set `"confirm": true` in JSON |
| Execution timeout | Insufficient timeout | Increase timeout value (use 1800s+ for large datasets) |
| `dj-process not found` | py-data-juicer not installed | `uv pip install py-data-juicer` |
| OOM | Insufficient memory | Reduce parallelism in system_spec |
| `401 Unauthorized` (retrieve) | Invalid or expired API Key | Use `retrieve_operators` (local, no API needed), or check `DASHSCOPE_API_KEY` for API retrieval |
| Empty operator results | Intent too narrow or unclear | Use a broader intent |
| `input_validation_failed` | Wrong parameter name | Check: `intent` (not query), `output_path` (not path) |
| Operator not found | Name was guessed | Must select from `retrieve_operators` output |

**General recovery steps**:
1. Read the error message carefully - most errors clearly state the problem
2. Check `djx tool schema <tool_name>` to verify input format
3. Fix the specific input and retry **once**
4. If the same step fails **2 times, stop** and report the error - do not retry indefinitely

---

## Permissions & Environment Requirements

| Feature | Dependency | Notes |
|---------|------------|-------|
| `retrieve_operators` (llm/auto mode) | `DASHSCOPE_API_KEY` | Cloud LLM |
| `apply_recipe` | `py-data-juicer>=1.4.0` | Core processing engine |
| LLM-based operators | Model endpoint configuration | e.g., language detection, quality scoring |

---

## Budget & Limits

| Metric | Limit | Reason |
|--------|-------|--------|
| Total tool calls | <= 30 | Cost control |
| `retrieve_operators` calls | <= 2 | Avoid excessive retrieval |
| `assemble_plan` calls | <= 1 | Idempotent operation |
| `apply_recipe` attempts | <= 2 | Diagnose after failure instead of retrying |

---

## Complete Example

**User request**: "Clean this dataset `/data/articles.jsonl` - remove HTML tags, normalize whitespace, fix encoding, filter entries with fewer than 100 characters, deduplicate."

```bash
# Step 1
djx tool run inspect_dataset --input-json '{"dataset_source": {"path": "/data/articles.jsonl"}, "sample_size": 50}'
# -> dataset_profile

# Step 2: Retrieve all needed operators at once
djx tool run retrieve_operators --input-json '{
  "intent": "remove HTML tags, normalize whitespace, fix unicode encoding, filter text shorter than 100 characters, deduplicate documents",
  "top_k": 15
}'
# -> clean_html_mapper, whitespace_normalization_mapper, fix_unicode_mapper, text_length_filter, document_deduplicator

# Step 3
djx tool run build_dataset_spec --input-json '{
  "intent": "clean HTML, normalize whitespace, fix unicode, filter short, deduplicate",
  "dataset_source": {"path": "/data/articles.jsonl"},
  "export_path": "/data/processed/articles.jsonl",
  "dataset_profile": <STEP_1_OUTPUT>
}'

# Step 4
djx tool run build_process_spec --input-json '{
  "operators": [
    {"name": "clean_html_mapper", "params": {}},
    {"name": "whitespace_normalization_mapper", "params": {}},
    {"name": "fix_unicode_mapper", "params": {}},
    {"name": "text_length_filter", "params": {"min_len": 100}},
    {"name": "document_deduplicator", "params": {}}
  ]
}'

# Step 5
djx tool run build_system_spec --input-json '{}'

# Step 6
djx tool run assemble_plan --input-json '{
  "intent": "clean HTML, normalize whitespace, fix unicode, filter short, deduplicate",
  "dataset_spec": <STEP_3_OUTPUT>,
  "process_spec": <STEP_4_OUTPUT>,
  "system_spec": <STEP_5_OUTPUT>
}'

# Step 7
djx tool run plan_save --yes --input-json '{
  "plan_payload": <STEP_6_OUTPUT>,
  "output_path": ".djx/plans/clean_filter_dedup.yaml"
}'

# Step 8
djx tool run apply_recipe --yes --input-json '{"plan_path": ".djx/plans/clean_filter_dedup.yaml", "confirm": true, "timeout": 600}'

# Step 9
djx tool run inspect_dataset --input-json '{"dataset_source": {"path": "/data/processed/articles.jsonl"}, "sample_size": 10}'
# Compare: input count vs output count, spot-check quality
```
