# FraserPay v2

## Environment configuration

The app **never** hardcodes project IDs, domains, or secrets — every value it
reads is an environment variable declared in [`.env.example`](./.env.example)
with a description and no value. To run locally, copy that file and fill it in:

```bash
cp .env.example .env.local
```

`.env.local` is gitignored; only `.env.example` is tracked. Never commit real
credentials.

### Variable groups

- **`NEXT_PUBLIC_FIREBASE_*`** — the four public client-SDK values (API key,
  auth domain, project id, app id) from the Firebase console Web App config.
  These ship in the browser bundle and are environment-specific but not secret.
- **`FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`** —
  server-only Admin SDK service-account credentials. **Secret.** The private key
  from the service-account JSON contains literal `\n` escape sequences; keep them
  as-is (wrap the value in double quotes) and the server converts them to real
  newlines before initializing the Admin SDK.
- **`SEED_SUPERADMIN_EMAIL`** — the `@pdsb.net` address the one-time
  `seed-superadmin` script promotes to superadmin.
- **`NEXT_PUBLIC_USE_EMULATORS` / `FIRESTORE_EMULATOR_HOST` /
  `FIREBASE_AUTH_EMULATOR_HOST`** — local Firebase Emulator Suite toggles; leave
  blank for any cloud environment.

## Local development

Local development is **emulator-first**: the Firebase Emulator Suite stands in
for real Auth and Firestore, so you can build, run, and test the whole app with
no cloud project and no credentials. The emulators always run under the throwaway
project id `demo-fraserpay` — the `demo-` prefix makes the Firebase tooling
refuse to contact any real Google Cloud backend, so a stray command can never
read or write production data.

### Prerequisite: Firebase CLI

The emulators are provided by the Firebase CLI, which is **not** a project
dependency — install it once, globally:

```bash
npm install -g firebase-tools     # or: mise use -g firebase-tools
firebase --version                # confirm it's on your PATH
```

No `firebase login` and no `.firebaserc` are needed for emulator work; every
command passes `--project demo-fraserpay` explicitly (committing a `.firebaserc`
would pin a personal project id, so we don't).

### Quick start (from a clean clone)

```bash
pnpm install
cp .env.example .env.local          # then set the emulator vars below
pnpm dev:emulators                  # terminal 1: auth + firestore emulators
pnpm dev                            # terminal 2: the Next.js app
```

Emulator UI runs at `http://127.0.0.1:4000`, Auth on `9099`, Firestore on
`8080` (fixed in `firebase.json`).

For `pnpm dev` to talk to the emulators, set these in `.env.local`:

```bash
NEXT_PUBLIC_USE_EMULATORS=true
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
```

### How the two SDKs reach the emulators

FraserPay uses two Firebase SDKs, and each is wired to the emulators by a
different environment variable:

- **Admin SDK (server)** — reads `FIRESTORE_EMULATOR_HOST` and
  `FIREBASE_AUTH_EMULATOR_HOST`. This is native `firebase-admin` behavior: when
  those variables are present it connects to the emulators automatically, with
  **no code branch**. This is also why `firebase emulators:exec` "just works" for
  tests — it injects both variables into the child process for you.
- **Client SDK (browser)** — cannot see server-only variables, so it keys off
  the public `NEXT_PUBLIC_USE_EMULATORS` flag. When it is `true`, the browser
  code calls `connectAuthEmulator` / `connectFirestoreEmulator` at startup;
  when blank it talks to the real project named by the `NEXT_PUBLIC_FIREBASE_*`
  values. (The client wiring itself lands with the login page in Phase P02.)

Leave all three blank for any cloud environment — that is the single switch that
turns emulator mode off.

### Integration tests

Integration tests run against the emulators rather than mocks. `pnpm test`
(Vitest) covers pure/unit code only; the integration suite is separate:

```bash
pnpm test:integration:emulate       # boots emulators, runs the integration suite, tears down
```

Under the hood that is `firebase emulators:exec --only auth,firestore --project
demo-fraserpay "pnpm test:integration"`. `test:integration` on its own runs the
Vitest integration config and expects the emulator env vars to already be set
(which `emulators:exec` provides). Integration specs live in `tests/integration/`
or as `*.integration.test.ts`; they never run in the plain `pnpm test`.

## Scripts

```bash
pnpm dev                      # start the dev server (Turbopack)
pnpm dev:emulators            # start the auth + firestore emulators
pnpm build                    # production build
pnpm typecheck                # tsc --noEmit
pnpm lint                     # ESLint
pnpm format:check             # Prettier check
pnpm test                     # Vitest (unit)
pnpm test:integration:emulate # emulator-backed integration suite
pnpm seed:dev                 # seed emulator fixtures (emulator env must be set)
pnpm seed:superadmin          # bootstrap the first SAC exec (see below)
```

## Superadmin bootstrap

SAC roles are granted in-app by an existing exec — but the very first exec has
to come from somewhere. `scripts/seed-superadmin.ts` promotes the account whose
email matches `SEED_SUPERADMIN_EMAIL` to **SAC exec**. Run it once per
environment; it is idempotent (safe to re-run) and portable (no project id,
domain, or secret is baked into the script — everything comes from env).

```bash
# Local (emulators): the emulator env vars route it at demo-fraserpay.
pnpm seed:superadmin:emulate            # boots emulators, seeds, tears down
# …or against already-running emulators:
pnpm seed:superadmin
```

What it does, depending on whether the person has signed in yet:

- **Account already exists** → sets `roles.sacExec` (and `sacMember`) on their
  user doc immediately.
- **Never signed in** → records a **pending grant** keyed by email; the grant is
  applied automatically the first time they sign in with Google (there is no
  account uid to target before then). Order-independent: seed first or sign in
  first, the result is the same.

### Against a cloud project

There is no emulator host in a cloud environment, so the script refuses to run
without an explicit target and a typed confirmation — you cannot promote an exec
on the wrong project by accident:

```bash
SEED_SUPERADMIN_EMAIL=exec@pdsb.net \
  pnpm seed:superadmin --project your-firebase-project-id
# → prompts: "Type the project id to confirm:"  (pass --yes to skip in CI)
```

Cloud runs use the Admin SDK service-account credentials
(`FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`), so
those must be set in the environment. Override the address ad hoc with
`--email <address>`.

If your `.env.local` still has the emulator host vars set (the normal dev
config), `firebase-admin` would connect to the local emulator instead of the
cloud — the script detects this and refuses. Blank them for the one-time cloud
run (a shell value takes precedence over the env file):

```bash
FIRESTORE_EMULATOR_HOST= FIREBASE_AUTH_EMULATOR_HOST= \
  pnpm seed:superadmin --project your-firebase-project-id
```

Toolchain versions (Node 24, pnpm) are pinned in [`mise.toml`](./mise.toml).
