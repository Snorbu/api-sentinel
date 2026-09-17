# api-sentinel

**Dependabot for APIs** — know the moment a vendor breaks your code.

`api-sentinel` snapshots the OpenAPI specs of the third-party APIs you depend on, diffs them between runs, classifies every change as **breaking / additive / cosmetic**, scans your repo for code that touches the broken surface, and files a markdown report. Exit code `1` on breaking changes, so it fails CI for you.

Built as a YC-grade demo: `snapshot` → `check` in one command, no config needed to see it work.

## Quickstart (no setup)

```bash
npx tsx src/cli.ts check \
  --old test/fixtures/spec-v1.json \
  --new test/fixtures/spec-v2.json \
  --api demo --repo demo --out report.md
echo $?   # 1 — breaking changes found
cat report.md
```

The report lists each breaking change and every file:line in your repo that uses the affected endpoint or field:

```
# API Sentinel report — demo
- breaking: 3, additive: 2, cosmetic: 4

## Breaking changes
- `removed` `...schema.properties.paid.type`
- `added`   `...schema.required.customer_id`
- `changed` `...properties.status.enum`

## Possibly affected code in this repo
- `demo/src/payment.ts:5` — token `paid` — `const body = (await res.json()) as { paid: boolean };`
```

## CI gate options

By default `check` exits 1 on **breaking** changes. Loosen or tighten with `--fail-on`:

```bash
api-sentinel check --fail-on none      # report-only: always exit 0
api-sentinel check --fail-on additive  # strict: any change fails
api-sentinel check --fail-on breaking  # default
```

## Live preview

```bash
npx tsx src/cli.ts preview        # serves the demo report at http://127.0.0.1:4173 and opens your browser
npx tsx src/cli.ts preview --config apis.yaml --repo .   # preview against your own snapshots
```

The page re-runs the check and refreshes every 5 seconds — edit the fixtures and watch it update.

## Watching a real API

Create `apis.yaml`:

```yaml
apis:
  - name: openai
    specUrl: https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml
```

```bash
npx tsx src/cli.ts snapshot --config apis.yaml   # run 1: saves baseline
npx tsx src/cli.ts snapshot --config apis.yaml   # run 2: rotates current -> previous
npx tsx src/cli.ts check    --config apis.yaml --repo .
```

Snapshots live in `snapshots/<name>/{previous,current}.json` — commit them so CI can diff across runs. Specs may be JSON or YAML.

## Severity rules

| Change | Severity |
| --- | --- |
| Response/request property removed | breaking |
| New **required** property or parameter | breaking |
| Property `.type` changed | breaking |
| Enum values **shrunk** (removed a case you may handle) | breaking |
| Endpoint/operation removed | breaking |
| New optional property | additive |
| Enum values grown | additive |
| Field stopped being required | cosmetic |
| Description/docs-only edits | cosmetic |

## In CI (GitHub Action)

Copy [`templates/sentinel.yml`](templates/sentinel.yml) into `.github/workflows/sentinel.yml` of the repo that consumes the API. Weekly (or manual) it snapshots, diffs, and on breaking changes opens a PR containing `report.md`.

## How it works

```
spec (JSON/YAML) ──flatten──> leaf map ──diff──> changes ──classify──> severity
                                                           │
your repo ──────────── token scan (file:line) <────────────┘
                                                           │
                       markdown report + exit code <───────┘
```

Pure TypeScript, zero runtime deps except `yaml`. No LLM calls, no accounts, no lock-in.

## Roadmap

- **v0.2** — LLM-generated fix PRs (patch the affected call sites, not just report them)
- **v0.3** — per-vendor agents that also watch changelogs/docs, not just specs
- **v0.4** — semantically-aware OpenAPI differ (`oneOf` reshuffles, parameter arrays)

## Dev

```bash
npm test        # vitest, 32 tests, no network
npm run build   # tsc -> dist/
```
