// shield-env-guard — block writes to credential and secret files.
//
// We catch the canonical accidental-leak patterns: .env files, SSH keys,
// PEMs, AWS / GCP / npm / pip credential files, and anything that looks
// like a secrets directory. The deny list is intentionally conservative —
// "are we sure this isn't a secret?" is a question we want the user to
// answer explicitly, not the agent.
//
// Triggers on PreToolUse for file-mutating tools.
// Configuration: <cwd>/.codex-toolkit/shield-env-guard.json
//   {
//     "mode": "enforce" | "ask" | "off",
//     "extra_patterns": ["..."],   // append paths/globs to deny
//     "allow_overrides": ["..."],  // paths/globs explicitly allowed
//   }

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  DECISIONS,
  FILE_MUTATING_TOOLS,
  emitDecision,
  emitError,
  extractTargetPath,
  parseHookInput,
} from './hook-protocol.js';

// Sensitive path globs. Matched with case-insensitive shell-style globs.
const DEFAULT_DENY_GLOBS = [
  // dotenv
  '.env',
  '.env.*',
  '**/.env',
  '**/.env.*',
  // SSH keys
  '**/id_rsa',
  '**/id_dsa',
  '**/id_ecdsa',
  '**/id_ed25519',
  '**/id_ed25519-sk',
  '**/id_ecdsa-sk',
  '**/.ssh/id_*',
  // PEM / cert / key files (broad)
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  // Cloud creds
  '**/.aws/credentials',
  '**/credentials.json',
  '**/gcloud-service-account*.json',
  '**/service-account*.json',
  // Package manager tokens
  '**/.npmrc',
  '**/.pypirc',
  '**/.netrc',
  // Sealed-secrets directories
  '**/secrets/**',
  '**/credentials/**',
  '**/.gnupg/**',
];

const DEFAULT_CONFIG = {
  mode: 'enforce',
  extra_patterns: [],
  allow_overrides: [],
  log: true,
};

function loadConfig() {
  const candidates = [
    process.env.CODEX_TOOLKIT_SHIELD_ENV_CONFIG,
    path.join(process.cwd(), '.codex-toolkit', 'shield-env-guard.json'),
    path.join(process.env.HOME || '', '.codex', 'shield-env-guard.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        emitError(`shield-env-guard: failed to read ${file}: ${err.message}`);
      }
    }
  }
  return { ...DEFAULT_CONFIG };
}

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '.') {
      re += '\\.';
    } else if ('+(){}|^$\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$', 'i');
}

function compileGlobs(globs) {
  return (globs || []).map((g) => globToRegex(g));
}

function matchesAny(target, regexes) {
  if (!target) return false;
  const norm = target.split(path.sep).join('/');
  return regexes.some((re) => re.test(norm));
}

export function evaluate(event) {
  const config = loadConfig();
  if (config.mode === 'off') {
    return { decision: DECISIONS.ALLOW, reason: null, skipped: true };
  }
  if (!FILE_MUTATING_TOOLS.has(event.toolName)) {
    return { decision: DECISIONS.ALLOW, reason: null, skipped: true };
  }
  const target = extractTargetPath(event.toolInput);
  if (!target) {
    return { decision: DECISIONS.ALLOW, reason: null };
  }

  const allowRe = compileGlobs(config.allow_overrides);
  if (matchesAny(target, allowRe)) {
    if (config.log) {
      process.stderr.write(`[shield-env-guard] allowed by override: ${target}\n`);
    }
    return { decision: DECISIONS.ALLOW, reason: null, override: true };
  }

  const denyRe = compileGlobs([...DEFAULT_DENY_GLOBS, ...(config.extra_patterns || [])]);
  if (!matchesAny(target, denyRe)) {
    return { decision: DECISIONS.ALLOW, reason: null };
  }
  const reason = `shield-env-guard: refused to write to "${target}" — matches a sensitive path (SSH key, .env, cloud cred, package-manager token, or secrets dir). If this is intentional, set "allow_overrides" in .codex-toolkit/shield-env-guard.json.`;
  if (config.log) {
    process.stderr.write(`[shield-env-guard] deny: ${target}\n`);
  }
  if (config.mode === 'ask') {
    return { decision: DECISIONS.ASK, reason };
  }
  return { decision: DECISIONS.DENY, reason };
}

// --- CLI entry point ---------------------------------------------------------

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

async function main() {
  const raw = await readStdin();
  const parsed = parseHookInput(raw);
  if (!parsed.ok) {
    emitError(`shield-env-guard: ${parsed.error}`);
    return;
  }
  const result = evaluate(parsed);
  emitDecision(result.decision, result.reason);
  if (result.decision === DECISIONS.DENY) {
    process.exit(2);
  }
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('shield-env-guard.js');
if (isMain) {
  main().catch((err) => emitError(err.stack || err.message));
}

export default { evaluate };
