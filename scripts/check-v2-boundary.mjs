import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), "utf8"));
}

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const tsconfig = readJson("tsconfig.json");
const eslintConfig = readFileSync(join(root, "eslint.config.mjs"), "utf8");
const prettierIgnore = readFileSync(join(root, ".prettierignore"), "utf8");
const firebaseConfig = readJson("firebase.json");
const legacyFirebaseConfig = readJson("legacy/fraserpay-sac/firebase.local.json");
const legacyRules = readFileSync(join(root, "legacy/fraserpay-sac/firestore.local.rules"), "utf8");
const rootRules = firebaseConfig.firestore?.rules;

check(
  Array.isArray(tsconfig.exclude) && tsconfig.exclude.includes("legacy"),
  "tsconfig.json must exclude the legacy checkout from v2 typechecking.",
);
check(eslintConfig.includes('"legacy/**"'), "eslint.config.mjs must ignore the legacy checkout.");
check(
  prettierIgnore.split(/\r?\n/).includes("legacy/"),
  ".prettierignore must exclude the legacy checkout from v2 formatting.",
);
check(
  rootRules === "firestore.rules",
  "Root Firebase deployment must use the v2 firestore.rules file.",
);
check(
  firebaseConfig.firestore?.indexes === "firestore.indexes.json",
  "Root Firebase deployment must use the v2 Firestore indexes.",
);
check(
  legacyFirebaseConfig.firestore?.rules === "firestore.local.rules",
  "Legacy emulator config must use its local-only Firestore rules.",
);
check(
  typeof rootRules === "string" && !rootRules.includes("legacy"),
  "Root Firebase deployment must not reference the legacy checkout.",
);
check(
  /Emulator-only rules for the legacy reference app/.test(legacyRules) &&
    /must never be deployed to a real Firebase project/.test(legacyRules),
  "Legacy Firestore rules must retain their local-only warning.",
);

if (failures.length > 0) {
  console.error("v2 boundary check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("v2 boundary check passed.");
}
