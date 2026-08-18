# Roadmap

The web app is feature-complete and fully tested; how it works is documented in [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Some Stuff

- [ ] Final full CI run (all tiers, including emulator integration and E2E)
- [x] Set up the staging Firebase + Vercel projects
- [ ] Enable point-in-time recovery and a scheduled backup on production; verify restore permissions actually work -> Jason needs to do it I don't want to pay for firebase
- [ ] Attach the custom domain, configure DNS, and verify the OAuth consent flow on the real domain -> Jason needs to do this
- [ ] Seed the first SAC exec and complete the full smoke-test on each environment (sign-in, booth lifecycle, top-up, charge, refund, feed, reconciliation, offline wallet reopen) -> Jason needs to do this with SAC
- [ ] Verify Vercel error alerting fires on a synthetic error; decide on a log drain for retention -> Jason needs to do this

## Test it with real people -> Jason needs to do this

- [ ] Tabletop event simulation with 4 to 6 people playing SAC member, exec, seller, and student: top-ups (including an over-cap exec override), sales, a dispute and refund, a wrong top-up corrected with a linked adjustment, a mid-flow suspension, then reconcile against a hand tally
- [ ] Multi-operator stress: several sellers charging in parallel on their own phones at one booth, including two operators ringing the same buyer
- [ ] Device matrix: camera scanning, PWA install, and offline wallet open on iPhone Safari and Android Chrome across several device generations, including the school's oldest common phones
- [ ] Booth-seller practice window on staging before the event, never on production
- [ ] Run the k6 lunch-rush scenario against staging for real latency numbers (p95 under 500 ms at 10 charges/second), then re-verify the ledger
- [ ] Offline drills: airplane-mode wallet open from the home screen, POS offline banner behavior mid-sale, and a full paper-slip fallback walkthrough
- [ ] Reconciliation dry run against a real cash box and a real card terminal batch total
- [ ] Usability watch: hand the POS to someone who has never seen it and observe a first sale with no coaching

## Hardening and fixes

- [ ] Independent second review of the money module against every invariant (the original invariant review was done by the implementer)
- [ ] Re-run the IDOR and authorization sweep across every `[id]` route now that all UI surfaces are final
- [ ] Tune rate limits with real staging load-test numbers instead of the initial estimates
- [ ] Capacity math: per-operation Firestore read/write counts from the load test, projected against event-day volume and quotas
- [ ] Dependency update and audit pass shortly before event week, then freeze
- [ ] Shared-device session review: sign-out purge behavior on school Chromebooks and library computers
- [ ] Error-copy review: every operator-facing error message read aloud by a non-developer for clarity under pressure
- [ ] Chaos checks: kill the POS tab mid-charge on a real phone and confirm the recovery card behaves exactly as designed
- [ ] Clock-skew check on real devices: confirm the duplicate-sale age indicator reads correctly on phones with wrong clocks
- [ ] Verify refunds subtract from a booth's total sales and show up in the booth's transaction history
- [ ] Deploy freeze policy for event week: emergency-only, with the rollback procedure rehearsed once

## UI and UX polish

- [ ] John Fraser branding pass: final palette, logo, and PWA icons (current tokens are placeholders)
- [ ] Wallet visual polish: this screen is the face of the app for 1,500 students
- [ ] POS success state readable at arm's length in a loud gym: bigger confirmation, clearer buyer name and amount
- [ ] Loading skeletons and empty states across the dashboard (feed before first transaction, reports before first sale, empty booth lists)
- [ ] Feed niceties: relative timestamps, smoother new-items indicator, sticky filters
- [ ] Student search ergonomics during a rush: keyboard-first flow, recent lookups
- [ ] Leaderboard page
- [ ] Booth member view polish: clearer gross and per-item tables for payout conversations
- [ ] Add a booth transaction history and a booth items view to the booth member screen
- [ ] Walk through the old FraserPay (v1) UI screen by screen to catch anything v2 is still missing
- [ ] Reports and reconciliation print/export view for the end-of-day closeout
- [x] iOS add-to-home-screen hint on the wallet
- [ ] Admin dashboard mobile usability pass for execs who manage from their phones
- [x] Small-screen audit at 320 px width across every student-facing page

## Deeper testing

- [x] Flake hunt: run the full E2E journey suite on repeat until three consecutive fully green runs are boring
- [ ] Extend axe accessibility scans to the remaining admin pages
- [ ] Lighthouse baseline for wallet and POS, tracked over time
- [ ] Visual regression snapshots for the wallet and POS shells
- [ ] Byte-budget trend tracking so the 170 KB wallet ceiling never creeps up silently
- [ ] Negative-path E2E additions: expired session mid-charge, revoked role mid-session, suspended buyer at the register

---
