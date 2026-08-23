$src = 'D:\dj\data-juicer-agents\skills\data-juicer-agents-harness-copaw-version'
$dst = 'D:\dsh-app\.dsh\skills'

New-Item -ItemType Directory -Force -Path $dst | Out-Null

$map = [ordered]@{
  'data-juicer' = 'data-juicer'
  'djx_apply' = 'djx-apply'
  'djx_auth' = 'djx-auth'
  'djx_context' = 'djx-context'
  'djx_dev' = 'djx-dev'
  'djx_install' = 'djx-install'
  'djx_local_model' = 'djx-local-model'
  'djx_plan' = 'djx-plan'
  'djx_process' = 'djx-process'
  'djx_retrieve' = 'djx-retrieve'
}

foreach ($entry in $map.GetEnumerator()) {
  $from = Join-Path $src $entry.Key
  $to = Join-Path $dst $entry.Value
  if (Test-Path -LiteralPath $to) {
    Remove-Item -LiteralPath $to -Recurse -Force
  }

  Copy-Item -LiteralPath $from -Destination $to -Recurse

  $skillPath = Join-Path $to 'SKILL.md'
  $text = [System.IO.File]::ReadAllText(
    $skillPath,
    [System.Text.UTF8Encoding]::new($false)
  )
  foreach ($pair in $map.GetEnumerator()) {
    $text = $text.Replace([string]$pair.Key, [string]$pair.Value)
  }
  $text = $text.Replace(
    'via the `djx tool` CLI.',
    'via the `D:\dj\data-juicer-agents\.venv\Scripts\djx.exe tool` CLI when bare `djx` is not on PATH.'
  )

  # Keep the DSH copies ASCII-only so terminal and browser encodings cannot garble guidance.
  $asciiReplacements = [ordered]@{
    ([string][char]0x2014) = '-'
    ([string][char]0x2192) = '->'
    ([string][char]0x2264) = '<='
    ([string][char]0x251C) = '+'
    ([string][char]0x2514) = '+'
    ([string][char]0x2500) = '-'
    ([string][char]0x2510) = '+'
    ([string][char]0x2502) = '|'
    ([string][char]0x2524) = '+'
    ([string][char]0x2518) = '+'
    ([string][char]0x25C4) = '<'
    ([string][char]0x25BC) = 'v'
    ([string][char]0x25A1) = '[ ]'
  }
  foreach ($replacement in $asciiReplacements.GetEnumerator()) {
    $text = $text.Replace([string]$replacement.Key, [string]$replacement.Value)
  }

  switch ($entry.Value) {
    'data-juicer' {
      $approvalGate = @'
## Approval Gate: Analyze First, Then Wait

Default to **analysis only**. First inspect the dataset, retrieve and evaluate operators, and build the proposed recipe in memory. These read-only planning actions are permitted without a confirmation.

Before any operation that writes a plan or changes data, stop and present a concise proposal containing the input and output paths, selected operators and parameters, expected effect and key trade-offs, and proposed validation and timeout. Then wait for a later, explicit user message such as `confirm execution of this proposal`.

Do **not** treat the original request, a vague acknowledgement such as `ok` or `continue`, the CLI `--yes` flag, or the `confirm: true` tool parameter as user authorization. Do not call `plan_save`, `apply_recipe` without `dry_run: true`, file-writing tools, or data-mutating shell/Python commands before that explicit approval. If the recipe, paths, or material parameters change after approval, present the revised proposal and ask again.

After explicit approval: save the plan, run a dry run, then run the recipe. Report output verification when complete.

## MCP Preference

When `mcp__dj__analyze_dataset`, `mcp__dj__search_ops`, and `mcp__dj__run_data_recipe` are available, prefer them to the CLI. Use `analyze_dataset` and `search_ops` during analysis. `run_data_recipe` changes data and is subject to the same explicit approval gate. Use the CLI only when the MCP is unavailable or does not expose the required capability.
'@
      $marker = '## Prerequisites'
      $text = $text.Insert($text.IndexOf($marker), "$approvalGate`n---`n`n")
    }
    'djx-plan' {
      $approvalGate = @'
## Approval Gate

`build_*` and `assemble_plan` may prepare and explain a proposal. `plan_save` writes a file, so wait for explicit approval of the displayed proposal before calling it. `--yes` is a CLI flag, not user approval.

'@
      $text = $text.Insert($text.IndexOf('## Prerequisites'), $approvalGate + "---`n`n")
    }
    'djx-apply' {
      $approvalGate = @'
## Approval Gate

Before `apply_recipe` with `confirm: true`, show the final recipe summary and wait for later explicit approval. A `dry_run: true` does not replace approval for the real run. `--yes` and `confirm: true` satisfy DJ command requirements only; neither is user authorization.

'@
      $text = $text.Insert($text.IndexOf('## Prerequisites'), $approvalGate + "---`n`n")
    }
    'djx-process' {
      $text = $text.Replace(
        "Execution tools (shell/Python) and file management tools (read/write/insert).",
        "Execution tools (shell/Python) and file management tools (read/write/insert).`r`n`r`n## Approval Gate for Data Processing`r`n`r`nWithin a Data-Juicer workflow, use shell/Python only for inspection and analysis until the user explicitly approves the displayed processing proposal in a later message. Do not write files, overwrite data, or launch transformations before that approval."
      )
    }
  }

  [System.IO.File]::WriteAllText(
    $skillPath,
    $text,
    [System.Text.UTF8Encoding]::new($false)
  )
}

Get-ChildItem -LiteralPath $dst -Directory | Select-Object Name
