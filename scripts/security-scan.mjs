import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SERVER_DIR = "src/lib/server";
const BUNDLE_DIR = ".next/static";

const SECRET_PATTERNS = [
  { name: "service-account private-key env marker", re: /FIREBASE_PRIVATE_KEY/ },
  { name: "PEM private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "service-account JSON", re: /"type"\s*:\s*"service_account"/ },
  {
    name: "service-account client email",
    re: /[A-Za-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com/,
  },
  { name: "service-account key id", re: /"private_key_id"\s*:/ },
];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else out.push(path);
  }
  return out;
}

async function scanServerOnly() {
  const dir = join(ROOT, SERVER_DIR);
  const files = (await walk(dir)).filter((f) => f.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(f));
  const missing = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (!/^import ["']server-only["'];/m.test(source)) missing.push(relative(ROOT, file));
  }
  if (missing.length > 0) {
    console.error(`✗ server-only: ${missing.length} file(s) in ${SERVER_DIR} lack the pragma:`);
    for (const file of missing) console.error(`    ${file}`);
    return false;
  }
  console.log(`✓ server-only: all ${files.length} files in ${SERVER_DIR} import "server-only"`);
  return true;
}

async function scanBundles() {
  let files;
  try {
    files = await walk(join(ROOT, BUNDLE_DIR));
  } catch {
    console.error(`✗ secrets: ${BUNDLE_DIR} not found — run "pnpm build" first`);
    return false;
  }
  const hits = [];
  for (const file of files) {
    const source = await readFile(file, "utf8").catch(() => "");
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(source)) hits.push(`${relative(ROOT, file)}: ${name}`);
    }
  }
  if (hits.length > 0) {
    console.error("✗ secrets: server credentials reached the client bundle:");
    for (const hit of hits) console.error(`    ${hit}`);
    return false;
  }
  console.log(
    `✓ secrets: ${files.length} files in ${BUNDLE_DIR} clean of ${SECRET_PATTERNS.length} credential patterns`,
  );
  return true;
}

const CHECKS = { "server-only": scanServerOnly, secrets: scanBundles };
const mode = argv[2] ?? "all";
const selected = mode === "all" ? Object.values(CHECKS) : [CHECKS[mode]];
if (selected.some((check) => check === undefined)) {
  console.error("usage: node scripts/security-scan.mjs [all|server-only|secrets]");
  exit(2);
}

const results = [];
for (const check of selected) results.push(await check());
exit(results.every(Boolean) ? 0 : 1);
