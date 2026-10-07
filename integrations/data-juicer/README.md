# Data-Juicer integration

This directory is the source-checkout-owned integration layer for the local
DSH + Data-Juicer deployment. It intentionally stays outside DSH's core
`packages/` tree:

- `bundles/operator-library` and `bundles/results-center` are local DSH 0.2
  bundles selected by the user's `web` profile.
- `skills/` is injected by the generated Cordis patch.
- `web-dj.ps1` runs `pnpm dsh web` from the checkout root and starts or
  reuses the local Data-Juicer MCP service. Re-run the affected package build
  after changing Web UI source files, then refresh the browser.
- `.runtime/` contains generated manifests, tokens, and patches and is ignored.
- populated `*.env` credential files are ignored; the matching examples are
  safe to commit.

From a fresh clone, install the pinned Data-Juicer checkout, both local bundles,
and the DSH source build once:

```powershell
& .\setup.ps1
```

Then start the complete source deployment from any directory:

```powershell
& '<clone>\start.ps1'
```

`start.ps1` ultimately runs `pnpm dsh web` in the checkout root. Web UI source
changes still need their affected package bundle rebuilt before a browser
refresh can load them. Use `setup.ps1 -CheckOnly` to validate the current
machine without starting either service.

Machine paths live in ignored `dsh-deployment.local.json`; the tracked
`dsh-deployment.example.json` documents the schema. Populated `*.env` files,
`.runtime/`, `.local/`, credentials, caches, workspaces, and result data never
belong in Git.
