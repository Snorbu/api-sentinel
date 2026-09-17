# API Sentinel report — demo

- spec: test/fixtures/spec-v1.json → test/fixtures/spec-v2.json
- fetched at: 2026-09-17T11:21:45.388Z
- breaking: 3, additive: 2, cosmetic: 4

## Breaking changes

- `removed` `paths./v1/charges.get.responses.200.content.application/json.schema.properties.paid.type`
- `changed` `paths./v1/charges.get.responses.200.content.application/json.schema.properties.status.enum`
- `added` `paths./v1/charges.get.responses.200.content.application/json.schema.required.customer_id`

## Possibly affected code in this repo

- demo/src/payment.ts:1 — token `/v1/charges` — `const CHARGES_URL = "/v1/charges";`
- demo/src/payment.ts:5 — token `paid` — `const body = (await res.json()) as { paid: boolean };`
- demo/src/payment.ts:6 — token `paid` — `return body.paid; // uses the field that gets removed in v2`
