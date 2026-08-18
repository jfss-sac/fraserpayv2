# Legacy FraserPay SAC reference

This folder documents the local-only checkout of [padhyeSohum/fraserpay-sac](https://github.com/padhyeSohum/fraserpay-sac). The source checkout is intentionally ignored by the FraserPay v2 repository so the legacy app and its dependencies are not bundled into v2 or deployed accidentally.

The current local checkout is at `legacy/fraserpay-sac` and was cloned from `main` at `aa3ed4b0ef142c9f5216baffba2d2a03bfc3b1b6`.

## Run it with the Firebase emulator

From the FraserPay v2 repository root, install the legacy app dependencies once:

```bash
cd legacy/fraserpay-sac
npm ci
cd ../..
```

Start the isolated Auth, Firestore, and Emulator UI processes in one terminal:

```bash
pnpm exec firebase emulators:start \
  --config legacy/fraserpay-sac/firebase.local.json \
  --project demo-fraserpay \
  --only auth,firestore
```

Start the legacy Vite app in a second terminal:

```bash
cd legacy/fraserpay-sac
npm run dev
```

Open `http://127.0.0.1:5173`. The Emulator UI is at `http://127.0.0.1:4100`.

## Seed fake local data

With the emulators running, use the idempotent local seeder from a second terminal:

```bash
cd legacy/fraserpay-sac
npm run seed:emulator
```

The seeded email/password logins are:

- Student: `P100001` / `Password123!`
- Booth manager: `P100003` / `Password123!`
- SAC admin: `909957` / `Password123!`
- Dedicated SAC admin: `SACADMIN` / `SACAdmin123!`

The booth PINs are `2468` (Campus Café), `1357` (Spirit Shop), and `8642` (Art Studio).

The legacy app uses the emulator-only `.env.local` in its own checkout. Google popup sign-in is not emulated; use the legacy email/password flow or create test users in the Auth Emulator UI. The local Firestore rules are deliberately permissive for reference work and must not be deployed.
