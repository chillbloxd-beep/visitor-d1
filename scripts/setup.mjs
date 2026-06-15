import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DB_NAME = process.env.D1_DATABASE_NAME || "visitor-analytics-fresh";
const DB_BINDING = "DB";
const CONFIG_PATH = "wrangler.jsonc";
const GENERATED_SECRETS_PATH = ".generated-secrets.json";

function fail(message) {
  console.error(`\nSetup stopped: ${message}\n`);
  process.exit(1);
}

function run(args, { capture = false, allowFailure = false } = {}) {
  console.log(`\n> npx wrangler ${args.join(" ")}`);

  try {
    const result = execFileSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["wrangler", ...args],
      {
        encoding: "utf8",
        stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
        env: {
          ...process.env,
          CI: process.env.CLOUDFLARE_API_TOKEN ? "true" : process.env.CI,
          FORCE_COLOR: "0",
          WRANGLER_SEND_METRICS: "false"
        }
      }
    );

    return capture ? result : true;
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

function parseJsonOutput(text) {
  const trimmed = String(text || "").trim();

  for (const [startToken, endToken] of [["[", "]"], ["{", "}"]]) {
    const start = trimmed.indexOf(startToken);
    const end = trimmed.lastIndexOf(endToken);

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // Try the next possible JSON shape.
      }
    }
  }

  throw new Error("Could not parse Wrangler JSON output.");
}

function readConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
}

function databaseId(database) {
  return database?.uuid || database?.id || database?.database_id || database?.databaseId;
}

function currentBinding(config) {
  return (config.d1_databases || []).find(
    (binding) => binding.binding === DB_BINDING && binding.database_name === DB_NAME
  );
}

function getStoredSecrets() {
  if (existsSync(GENERATED_SECRETS_PATH)) {
    return JSON.parse(readFileSync(GENERATED_SECRETS_PATH, "utf8"));
  }

  const generated = {
    ANALYTICS_ADMIN_KEY:
      process.env.ANALYTICS_ADMIN_KEY || randomBytes(24).toString("base64url"),
    IP_HASH_SALT:
      process.env.ANALYTICS_IP_HASH_SALT || randomBytes(32).toString("base64url")
  };

  writeFileSync(
    GENERATED_SECRETS_PATH,
    `${JSON.stringify(generated, null, 2)}\n`,
    { mode: 0o600 }
  );

  return generated;
}

function ensureAuthentication() {
  if (process.env.CLOUDFLARE_API_TOKEN) {
    if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
      fail("CLOUDFLARE_ACCOUNT_ID is required when CLOUDFLARE_API_TOKEN is used.");
    }

    console.log("Using Cloudflare API-token authentication.");
    return;
  }

  console.log("No API token found. Checking Wrangler OAuth login...");

  if (!run(["whoami"], { allowFailure: true })) {
    console.log("Opening Cloudflare OAuth login. Follow the URL Wrangler prints.");
    run(["login"]);
    run(["whoami"]);
  }
}

ensureAuthentication();

console.log("\nStarting a greenfield analytics deployment.");
console.log("No external database or previous analytics source will be read.");
console.log("Worker: visitor-analytics-d1-fresh");
console.log(`D1 database: ${DB_NAME}`);

const configBefore = readConfig();
const databases = parseJsonOutput(run(["d1", "list", "--json"], { capture: true }));
const existing = databases.find((database) => database.name === DB_NAME);

if (existing) {
  const existingId = databaseId(existing);
  const binding = currentBinding(configBefore);

  if (!existingId) {
    fail(`Found ${DB_NAME}, but could not determine its database ID.`);
  }

  if (!binding || binding.database_id !== existingId) {
    fail(
      `A D1 database named ${DB_NAME} already exists but is not bound to this project. ` +
      "To guarantee a fresh database, rerun with a new name, for example: " +
      'D1_DATABASE_NAME="visitor-analytics-fresh-2" npm run setup'
    );
  }

  console.log(`Reusing this project's already-bound D1 database ${DB_NAME}.`);
} else {
  run([
    "d1",
    "create",
    DB_NAME,
    "--location",
    "apac",
    "--binding",
    DB_BINDING,
    "--update-config"
  ]);
}

run(["d1", "migrations", "apply", DB_BINDING, "--remote"]);

const secretsObject = getStoredSecrets();
const secretsFile = join(tmpdir(), `analytics-secrets-${process.pid}.json`);
writeFileSync(secretsFile, JSON.stringify(secretsObject), { mode: 0o600 });

try {
  run(["deploy", "--secrets-file", secretsFile]);
} finally {
  try {
    writeFileSync(secretsFile, "");
  } catch {
    // Best-effort cleanup only.
  }
}

console.log("\nFresh setup complete.");
console.log("No external database or previous analytics data was read or imported.");
console.log("Open the workers.dev URL printed above.");
console.log("Dashboard: /dashboard.html");
console.log(`Dashboard key: ${GENERATED_SECRETS_PATH}`);
console.log("Do not commit the generated secret file.");
