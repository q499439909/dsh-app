# DSH Data-Juicer Operator Library

Read-only DSH plugin that shows every operator exposed by the live Data-Juicer
plan-flow registry. It provides responsive catalog filters, category-aware
cards, and an in-panel detail page with parameter metadata. The Host half
proxies catalog and detail requests through same-origin DSH routes; the Client
half registers a sidebar action and fills `shell.auxiliary`.

The UI prefers the backend's checked-in `zh-CN` presentation metadata: Chinese
operator and parameter names are shown above their immutable English registry
identifiers, Chinese summaries are searchable alongside the English originals,
and untranslated future operators remain visible with a pending badge.

## Configuration

```yaml
- id: dj-operator-library
  name: '@dsh-dj/operator-library'
  config:
    catalogUrl: http://127.0.0.1:8010/operator-catalog
```

By default, the detail endpoint is derived as `/operator-detail` on the same
loopback server. It can be overridden with `detailUrl` when needed.

The current DSH `0.1.1-rc.2` deployment also needs the committed ui-layout
compatibility patch that declares `shell.auxiliary`.
