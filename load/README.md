# Load testing (NFR-5)

k6 scripts that prove the lunch-rush target — **1,500 students / 40 booths / ~10 charges per second sustained, p95 API latency < 500 ms** (NFR-5) — plus a correctness storm the ledger verifier must survive.

Two things are being measured, and they are **not** the same environment:

| Goal                                                     | Where                                        | Why                                                                                  |
| -------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| Correctness + contention + idempotency under concurrency | **Local** (`next start` + Firebase emulator) | Emulator gives a real transactional Firestore; latency numbers here are meaningless. |
| Real p95 latency vs the 500 ms threshold                 | **Staging**                                  | Only production infra + real network give trustworthy latency.                       |

## Prerequisites

- `k6` on `PATH` — `brew install k6` (verify with `k6 version`).
- The rest is already in the repo: the seed script mints session cookies straight from the Auth emulator (no browser sign-in), so k6 authenticates by sending `__session` cookies.

## Scripts

| File                   | Scenario                                                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lunch-rush.js`        | Sustained mix: **10/s charges + 30/s lookups + 0.5/s top-ups**, `DURATION` (default 10m). Thresholds: `http_req_duration{expected_response:true} p(95)<500`, `unexpected_errors rate<0.01` (intentional `INSUFFICIENT_FUNDS` excluded).             |
| `profile.js`           | The load model itself — rates, pool sizes, and the rate-limit caps it assumes. Imported by `lunch-rush.js` and asserted by `profile.test.ts` (runs in `pnpm test`, no emulator needed).                                                             |
| `correctness-storm.js` | Two concurrent storms on isolated fixtures: **contention** (many sellers charge the same low-balance buyers — oversell must be impossible) and **idempotency** (duplicate `Idempotency-Key`s from one seller — the charge must apply exactly once). |
| `lib.js`               | Shared helpers: base URL, cookie headers, UUIDv4 idempotency keys, request builders.                                                                                                                                                                |

Fixtures are read from `load/fixtures/load-fixtures.json`, produced by the seed step. That file is generated, not committed.

## Local run (correctness + contention)

Run each block in its own terminal from the repo root. The emulator must stay up for the whole run, so this uses a **persistent** emulator (not `emulators:exec`).

```sh
# 1. Persistent emulator (leave running)
pnpm dev:emulators

# 2. Seed load fixtures + mint cookies into that emulator
pnpm seed:load:demo

# 3. Production build, served against the emulator (leave running)
pnpm build
pnpm start:demo            # serves http://127.0.0.1:3000 with .env.demo

# 4. Correctness storm — contention + idempotency races
ACCEPT_ABORTS=1 k6 run load/correctness-storm.js

# 5. Lunch-rush — shorten locally if you only want a smoke (emulator latency is not the metric)
k6 run load/lunch-rush.js                 # full 10 min
DURATION=2m k6 run load/lunch-rush.js     # quick pass

# 6. Post-run correctness gates — both must pass
pnpm verify:ledger:emulate                # balances reconcile against the ledger
pnpm check:load:demo                       # zero duplicate charges, no negative balances
```

`check:load` is the idempotency proof that `verify:ledger` cannot give on its own: a double charge moves the balance _and_ the ledger together, so reconciliation stays green — only `(actorUid, idempotencyKey)` uniqueness in the ledger catches it. These two gates — not the k6 exit code — are the correctness verdict for the local run.

### Emulator lock timeouts (`ACCEPT_ABORTS`)

The Firestore **emulator** is single-process and serializes contended writes with pessimistic locks; under a heavy storm it returns `ABORTED: Transaction lock timeout` (surfaced as an `INTERNAL` 500). An aborted transaction commits **nothing**, so it never corrupts the ledger — production Firestore uses optimistic retry and does not exhibit this. `ACCEPT_ABORTS=1` reclassifies those 500s as a tracked `contention_aborted` metric instead of a hard failure, so the storm still fails on any _other_ 500. **Leave `ACCEPT_ABORTS` unset on staging**, where every 500 is a real defect.

### Re-running from a clean slate

The storm mutates balances and writes fixed idempotency keys, so a second run on the same data mostly replays. To re-measure, wipe Firestore and re-seed:

```sh
curl -X DELETE "http://127.0.0.1:8080/emulator/v1/projects/demo-fraserpay/databases/(default)/documents"
pnpm seed:load:demo
```

### Overrides (env vars)

Seed pool sizes: `LOAD_BOOTHS` (40), `LOAD_SELLERS_PER_BOOTH` (2), `LOAD_CHARGE_BUYERS` (300), `LOAD_TOPUP_BUYERS` (150), `LOAD_SAC_MEMBERS` (4), `LOAD_CONTENTION_BUYERS` (6), `LOAD_CONTENTION_SELLERS` (40), `LOAD_IDEMPOTENCY_BUYERS` (30).

k6: `BASE_URL` (`http://127.0.0.1:3000`), `LOAD_FIXTURES` (`./fixtures/load-fixtures.json`), `DURATION`, `CHARGE_RATE`, `LOOKUPS_PER_CHARGE` (3), `LOOKUP_RATE` (defaults to `CHARGE_RATE × LOOKUPS_PER_CHARGE`), `TOPUP_RATE_PER_MIN`, `SELLER_POOL`, `EXPECT_RATE_LIMIT`, `CONTENTION_ITERS`, `IDEMPOTENCY_ITERS`, `DUPLICATES_PER_KEY`.

### Why the mix is 3 lookups per charge

The POS cannot ring a sale until a lookup has resolved — `canCharge` requires
`sufficiency.status === "ready"` — so **lookups can never trail charges**. On top of
that floor come abandoned scans, "not them — scan again", the "Refresh balance"
button, and the automatic re-lookup after an `INSUFFICIENT_FUNDS` rejection. The
default models 3 lookups per charge; override with `LOOKUPS_PER_CHARGE` (or pin
`LOOKUP_RATE` directly).

### Why the run produces no 429s

Rate limits are per-uid (charge 120/min, lookup 120/min, top-up 40/min). The seed
provisions 40 booths × 2 sellers = 80 seller accounts, which is the real event
shape, so the default profile sits at **7.5 charges/min and 22.5 lookups/min per
uid — 6% and 19% of their caps**. A clean run therefore reports zero `rate_limited`,
and that is the spec being met, not a gap in coverage: PRD NFR-8 requires that "a
lunch-rush operator never meets one". `profile.test.ts` asserts that headroom, and
`setup()` re-checks it against the actual fixture pool and aborts the run rather than
letting you silently measure the limiter.

To deliberately probe the limiter, narrow the pool and say so — `SELLER_POOL=4
EXPECT_RATE_LIMIT=1 k6 run load/lunch-rush.js`. That reclassifies 429s as an expected,
counted outcome (`rate_limited`) instead of a hard failure. **Do not** read an NFR-5
p95 off such a run: a rejected request is a cheap path that flatters the percentile.

## Staging run (real latency)

Run this against the staging deployment. Staging has **no dev-login and no emulator**, so fixtures/cookies must be provisioned by whoever owns that environment; do **not** point the emulator seed at a cloud project (it refuses to run without `FIRESTORE_EMULATOR_HOST`). Then:

```sh
BASE_URL=https://<staging-host> k6 run load/lunch-rush.js
# afterwards, against the staging project:
pnpm verify:ledger --project <staging-project-id>
node --import tsx scripts/check-load-integrity.ts --project <staging-project-id>
```

Record the staging p95 — that is the number NFR-5 is judged on, with the caveat that emulator latency is not production latency.

## Capturing the summary

k6 prints its end-of-test summary to stdout. Capture it for the baseline doc with:

```sh
k6 run --summary-export load/last-summary.json load/lunch-rush.js | tee load/last-run.txt
```

Neither output file is committed.
