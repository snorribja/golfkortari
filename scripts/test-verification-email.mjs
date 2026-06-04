import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const DEFAULT_CONTINUE_URL = "https://golfkortari.snorribjarkason.com/#login";

function parseArgs(argv) {
  const args = {
    email: `golfkortari-verification-test-${Date.now()}@example.com`,
    password: `Golfkortari-test-${Math.random().toString(36).slice(2)}A1!`,
    continueUrl: DEFAULT_CONTINUE_URL,
    keepUser: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--email") {
      args.email = argv[index + 1];
      index += 1;
    } else if (arg === "--password") {
      args.password = argv[index + 1];
      index += 1;
    } else if (arg === "--continue-url") {
      args.continueUrl = argv[index + 1];
      index += 1;
    } else if (arg === "--keep-user") {
      args.keepUser = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.email || !args.email.includes("@")) {
    throw new Error("Pass a valid email with --email.");
  }

  if (!args.password || args.password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/test-verification-email.mjs --email you@example.com

Options:
  --email <email>          Email to register and send verification to.
  --password <password>    Password for the temporary test account.
  --continue-url <url>     Verification return URL.
  --keep-user              Do not delete the temporary Firebase Auth user.

Without --email, the script uses a synthetic @example.com address. That tests
whether Firebase accepts the verification send request, but no one can receive
that email.
`);
}

function loadFirebaseConfig() {
  const configPath = resolve("firebase-config.js");
  const source = readFileSync(configPath, "utf8").replace(
    "export const firebaseConfig =",
    "globalThis.firebaseConfig =",
  );
  const sandbox = {};
  vm.runInNewContext(source, sandbox, { filename: configPath });

  if (!sandbox.firebaseConfig?.apiKey) {
    throw new Error("Could not read apiKey from firebase-config.js.");
  }

  return sandbox.firebaseConfig;
}

async function callIdentityToolkit(apiKey, method, payload) {
  const url = `https://identitytoolkit.googleapis.com/v1/${method}?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const code = body?.error?.message || `HTTP_${response.status}`;
    const detail = JSON.stringify(body, null, 2);
    throw new Error(`${method} failed: ${code}\n${detail}`);
  }

  return body;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const firebaseConfig = loadFirebaseConfig();

  console.log("Firebase project:", firebaseConfig.projectId);
  console.log("Test email:", args.email);
  console.log("Continue URL:", args.continueUrl);

  let idToken = "";
  try {
    const signup = await callIdentityToolkit(firebaseConfig.apiKey, "accounts:signUp", {
      email: args.email,
      password: args.password,
      returnSecureToken: true,
    });

    idToken = signup.idToken;
    console.log("Created test Auth user:", signup.localId);

    const sendResult = await callIdentityToolkit(firebaseConfig.apiKey, "accounts:sendOobCode", {
      requestType: "VERIFY_EMAIL",
      idToken,
      continueUrl: args.continueUrl,
    });

    console.log("Verification send accepted by Firebase for:", sendResult.email);
    console.log("Result: PASS_API_ACCEPTED");
  } finally {
    if (idToken && !args.keepUser) {
      try {
        await callIdentityToolkit(firebaseConfig.apiKey, "accounts:delete", { idToken });
        console.log("Deleted temporary test user.");
      } catch (error) {
        console.warn("Could not delete temporary test user.");
        console.warn(error.message);
      }
    }
  }
}

main().catch((error) => {
  console.error("Result: FAIL");
  console.error(error.message);
  process.exitCode = 1;
});
