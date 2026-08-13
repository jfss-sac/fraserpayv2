export const EMULATOR_HOST_ENV = {
  auth: "FIREBASE_AUTH_EMULATOR_HOST",
  firestore: "FIRESTORE_EMULATOR_HOST",
} as const;

export type EmulatedService = keyof typeof EMULATOR_HOST_ENV;

const SERVICES = Object.keys(EMULATOR_HOST_ENV) as EmulatedService[];

export function usingEmulators(required: readonly EmulatedService[]): boolean {
  const configured = SERVICES.filter((service) => Boolean(process.env[EMULATOR_HOST_ENV[service]]));
  if (configured.length === 0) return false;

  const missing = required.filter((service) => !configured.includes(service));
  if (missing.length === 0) return true;

  const names = (services: readonly EmulatedService[]): string =>
    services.map((service) => EMULATOR_HOST_ENV[service]).join(", ");
  throw new Error(
    `Partial emulator configuration: ${names(configured)} set but ${names(missing)} unset. ` +
      "firebase-admin routes per service, so this process would talk to the emulator for one service " +
      "and to the configured cloud project for another. Set every emulator host this process needs, or none.",
  );
}
