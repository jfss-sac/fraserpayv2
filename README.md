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

## Scripts

```bash
pnpm dev            # start the dev server (Turbopack)
pnpm build          # production build
pnpm typecheck      # tsc --noEmit
pnpm lint           # ESLint
pnpm format:check   # Prettier check
pnpm test           # Vitest
```

Toolchain versions (Node 24, pnpm) are pinned in [`mise.toml`](./mise.toml).
