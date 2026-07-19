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

### Environment separation

Each environment is a **separate Firebase project** with its own `.env` values;
nothing is shared and development data never migrates anywhere (see
[architecture §19](./.docs/architecture.md#19-environments-configuration-and-portability-d15)).

| Environment    | Firebase project                                                           | Data                                        |
| -------------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| **Local**      | Firebase Emulator Suite (default for `pnpm dev`) — no cloud project needed | Seed fixtures, throwaway                    |
| **Dev**        | Each developer's own project (optional)                                    | Developer-only; never reused                |
| **Staging**    | The deployer's staging project                                             | Booth-practice data, wiped before the event |
| **Production** | The deployer's production project                                          | Real event data                             |

Local development runs entirely against emulators, so no cloud project is
required to build, run, or test the app. Pointing at a real project is just an
env-file switch. Setup and deployment for cloud environments are documented in
the architecture doc's Production handoff procedure.

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
```

Toolchain versions (Node 24, pnpm) are pinned in [`mise.toml`](./mise.toml).
