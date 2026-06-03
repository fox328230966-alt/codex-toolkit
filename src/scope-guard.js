// scope-guard — the core hook of codex-toolkit.
//
// Problem: AI coding agents (Codex CLI included) tend to expand their action
// surface beyond the task you actually asked for. "Fix the bug in auth.ts"
// turns into "while I'm here, let me also reformat 30 unrelated files and
// rewrite the README." This hook is the line of defense.
//
// How it works:
//   1. You declare the task scope in a config file (see examples/scope-guard.config.example.json).
//      Examples: { allow: ["src/auth/**", "tests/auth/**"] }
//   2. When Codex is about to mutate a file, the hook reads the target path
//      and checks it against the declared scope.
//   3. If the path is OUT of scope, the hook returns a `deny` decision with
//      a human-readable reason. Codex's permission system then surfaces that
//      to the user (or auto-blocks, depending on approval policy).
//
// Run modes:
//   - "enforce"  -> deny out-of-scope edits outright (default)
//   - "ask"      -> ask the user to confirm out-of-scope edits
//   - "off"      -> disabled (the hook still logs the decision)

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

const DEFAULT_CONFIG = {
  mode: 'enforce',
  // Default allow: everything except the deny list. Users override this
  // with their own scope-guard.json when they want a tighter scope.
  allow: ['**/*'],
  // Default deny: paths that almost never should be AI-edited, even when
  // the user has not configured anything. v0.1.0–v0.4.1 had `deny: []`,
  // which meant "default mode: enforce" was a no-op for users who never
  // wrote a config. The P1 bug found in v0.4.1 dogfooding was that the
  // installed hook also broke (couldn't find its deps), so users
  // installed + doctor reported green even though real Codex sessions
  // would never fire the guard. This default deny list means a brand
  // new install now refuses the most common dangerous writes out of
  // the box, which matches the README's "default mode: enforce" claim.
  deny: [
    '.env',
    '.env.*',
    '**/.env',
    '**/.env.*',
    '**/secrets/**',
    '**/.git/**',
  ],
  log: true,
};

function loadConfig() {
  // Config resolution order (closest wins):
  //   1. $CODEX_TOOLKIT_SCOPE_GUARD_CONFIG  (explicit override)
  //   2. <cwd>/.codex-toolkit/scope-guard.json
  //   3. ~/.codex/scope-guard.json
  const explicit = process.env.CODEX_TOOLKIT_SCOPE_GUARD_CONFIG;
  const candidates = explicit
    ? [explicit]
    : [
        path.join(process.cwd(), '.codex-toolkit', 'scope-guard.json'),
        path.join(process.env.HOME || '', '.codex', 'scope-guard.json'),
      ];
  for (const file of candidates) {
    if (!file) continue;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...parsed, __source: file };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        emitError(`scope-guard: failed to read config ${file}: ${err.message}`);
      }
    }
  }
  return { ...DEFAULT_CONFIG, __source: null };
}

// Minimal glob matching supporting **, *, ? and character classes.
// We deliberately avoid pulling in a glob library — the scope of codex-toolkit
// is "small and shippable", and a 30-line matcher covers 99% of real cases.
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
  return new RegExp('^' + re + '$');
}

function matchesAny(target, patterns) {
  const norm = target.split(path.sep).join('/');
  return (patterns || []).some((p) => globToRegex(p).test(norm));
}

function decide(config, targetPath) {
  if (!targetPath) {
    return { decision: DECISIONS.ALLOW, reason: null };
  }
  if (matchesAny(targetPath, config.deny)) {
    return {
      decision: DECISIONS.DENY,
      reason: `scope-guard: "${targetPath}" matches a deny pattern. Refusing the edit.`,
    };
  }
  if (matchesAny(targetPath, config.allow)) {
    return { decision: DECISIONS.ALLOW, reason: null };
  }
  if (config.mode === 'off') {
    return { decision: DECISIONS.ALLOW, reason: null };
  }
  if (config.mode === 'ask') {
    return {
      decision: DECISIONS.ASK,
      reason: `scope-guard: "${targetPath}" is outside the declared scope ${JSON.stringify(
        config.allow
      )}. Approve this out-of-scope edit?`,
    };
  }
  return {
    decision: DECISIONS.DENY,
    reason: `scope-guard: "${targetPath}" is outside the declared scope ${JSON.stringify(
      config.allow
    )}. Update your .codex-toolkit/scope-guard.json if this edit is intentional.`,
  };
}

export function evaluate(event) {
  const config = loadConfig();
  if (!FILE_MUTATING_TOOLS.has(event.toolName)) {
    return { decision: DECISIONS.ALLOW, reason: null, skipped: true };
  }
  const target = extractTargetPath(event.toolInput);
  const result = decide(config, target);
  if (config.log) {
    process.stderr.write(
      `[scope-guard] tool=${event.toolName} target=${target ?? '(none)'} -> ${result.decision}\n`
    );
  }
  return { ...result, config: { ...config, __source: undefined } };
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
    emitError(`scope-guard: ${parsed.error}`);
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
  process.argv[1]?.endsWith('scope-guard.js');
if (isMain) {
  main().catch((err) => emitError(err.stack || err.message));
}

export default { evaluate };
