# api-sentinel

**Dependabot for APIs** — know the moment a vendor breaks your code.

`api-sentinel` snapshots the OpenAPI specs of the third-party APIs you depend on, diffs them between runs, classifies every change as **breaking / additive / cosmetic**, scans your repo for code that touches the broken surface, and files a markdown report. Exit code `1` on breaking changes, so it fails CI for you.

Built as a YC-grade demo: `snapshot` → `check` in one command, no config needed to see it work.

## Quickstart (setup in ~2 minutes)

```bash
# in the repo that calls a vendor API:
npx api-sentinel init            # writes apis.yaml by detecting your package.json deps
npx api-sentinel snapshot --config apis.yaml   # baseline (run twice)
npx api-sentinel check --config apis.yaml --repo .
```

## Instant demo (no setup)

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

## Semantic diffing

Before diffing, both specs are normalized so refactors don't masquerade as changes:

- local `$ref`s (`#/components/schemas/…`, `#/$defs/…`) are inlined — moving a schema behind a ref is a no-op (recursive refs are left intact).
- `oneOf` / `anyOf` / `allOf` branches are content-sorted — reshuffles are a no-op.
- `enum`, `required`, and `tags` member order is normalized.
- `parameters` arrays are keyed by `in:name`, so a parameter is tracked by identity: reordering is silent, while a **new required parameter** or an optional one **becoming required** is reported as breaking (and its name is fed to the code scanner).

## Watching changelogs, not just specs

Vendors usually announce a deprecation in prose weeks before the spec changes. Add `changelogUrl` to any api entry:

```yaml
apis:
  - name: acme
    specUrl: https://acme.dev/openapi.json
    changelogUrl: https://acme.dev/changelog
```

`snapshot` saves the page next to the spec (`snapshots/<name>/changelog.{current,previous}.txt`, rotated the same way). `check` diffs the two snapshots and lists **newly published lines containing risk language** (deprecated, sunset, will be removed, breaking, migrate, …) under *Vendor changelog signals* in the report.

These signals are **informational** — prose is a heuristic, so it never changes the exit code. A failing changelog fetch warns but never fails `snapshot`.

## Severity rules

| Change | Severity |
| --- | --- |
| Response/request property removed | breaking |
| New **required** property or parameter | breaking |
| Property `.type` changed | breaking |
| Enum values **shrunk** (removed a case you may handle) | breaking |
| Endpoint/operation removed | breaking |
| New **required** parameter, or a parameter becoming required | breaking |
| Parameter reorder / `oneOf` reshuffle / `$ref` extraction | not reported |
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

## Security (LLM fix generation)

The `fix` command sends data to an LLM. What leaves your machine:

- **Sent:** the breaking change (from the vendor's public spec), the affected `file:line` usages, and the **full contents of only the affected files**.
- **Never sent:** snapshots, unrelated files, or any credentials.

Prompt-injection hardening: vendor-controlled spec text is wrapped in a "DATA, not instructions" contract. The model's reply is treated as inert data — it can only produce structured find/replace patches, and a patch is written **only if its `find` text exists verbatim** in the target file (first occurrence, re-verified at apply time). Patches may not reference files outside the scan results. No `eval`, no shell, no dynamic imports of model output.

Configure the provider with env vars (any OpenAI-compatible endpoint):

| Variable | Meaning | Default |
| --- | --- | --- |
| `API_SENTINEL_LLM_BASEURL` | chat-completions base URL | `https://api.openai.com/v1` |
| `API_SENTINEL_LLM_KEY` | API key (required for `fix`) | — |
| `API_SENTINEL_LLM_MODEL` | model id | `gpt-4o-mini` |

`fix` is **dry-run by default**; pass `--yes` to write. Exit codes: `0` all breaking changes patched (or none needed), `1` at least one breaking change the model couldn't patch, `2` usage error.

## Roadmap

- [x] **v0.1** — snapshot → diff → classify → scan → report CLI + live preview
- [x] **v0.2** — LLM-generated fixes (`fix` command: patches affected call sites, dry-run default, verbatim-match validation)
- [x] **v0.3** — per-vendor changelog/docs watching (`changelogUrl`: snapshots the page, diffs it, flags new deprecation language)
- [x] **v0.4** — semantically-aware OpenAPI differ (`$ref` inlining, `oneOf` reshuffles, parameter arrays keyed by `in:name`)

## Who it's for

**Honest wedge:** teams and agents calling vendor APIs over **raw HTTP** (fetch/requests/scripts), where no compiler protects you. If you use typed vendor SDKs, you already have partial protection — api-sentinel detects that (`detectSdks`) and tells you what's still uncovered: SDK updates lag the spec, and code bypassing the SDK is exposed.

**Known limitations, stated up front:** spec diffing is leaf-based on top of semantic normalization (`$ref`s are inlined only for local pointers; remote `$ref`s are not followed); scanner tokens can false-positive in big repos (suppress via `.sentinelignore`); LLM patches are suggestions with verbatim-match validation, not guarantees — review them.

## Dev

```bash
npm test        # vitest, 125 tests, no network
npm run build   # tsc -> dist/
```
