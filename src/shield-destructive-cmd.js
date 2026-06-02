// shield-destructive-cmd — block the small set of shell commands that can
// destroy a project (or worse, the whole home directory) in one keystroke.
//
// Philosophy: the goal is not to be a security product. The goal is to catch
// the 1% of commands that, if Codex gets the syntax wrong, will take your
// project with it. We default-deny on the canonical destructive patterns;
// users can override per-project via config.
//
// Triggers on PreToolUse for shell-style tools (Bash, shell, exec).
// Configuration: <cwd>/.codex-toolkit/shield-destructive-cmd.json
//   {
//     "mode": "enforce" | "ask" | "off",
//     "extra_patterns": ["regex", ...],     // appended to the default list
//     "allow_overrides": ["regex", ...],    // matched against the FULL command
//   }

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  DECISIONS,
  SHELL_TOOLS,
  emitDecision,
  emitError,
  extractShellCommand,
  parseHookInput,
} from './hook-protocol.js';

// Default deny list. Each entry is [name, regex, why]. Order does not matter;
// every matching pattern is reported.
//
// We use `(?=\s|$)` (or `(?=\s|;|$)`) at the end of patterns that may
// terminate on a non-word character such as `~` or `.`. Plain `\b` does not
// match between two non-word characters (e.g. between `~` and a space), so
// the standard "end of argument" anchor would miss `rm -rf ~` and similar.
const DEFAULT_DENY = [
  ['rm-rf-root', /\brm\s+(-[rRfF]+\s+)*\/(?=\s|$|;)/i, 'recursively deleting root (/)'],
  ['rm-rf-home', /\brm\s+(-[rRfF]+\s+)*(~|\$HOME|\/Users\/[^/\s]+)(?=\s|$|;)/i, 'recursively deleting the home directory'],
  ['rm-rf-cwd', /\brm\s+(-[rRfF]+\s+)*\.(?=\s|$|;)/i, 'recursively deleting the current directory'],
  ['rm-rf-star', /\brm\s+(-[rRfF]+\s+)*\*(?=\s|$|;)/i, 'rm with a bare glob can sweep more than you expect'],

  ['git-force-push', /\bgit\s+push\s+(-[^\s]*\bf\b|--force(-with-lease)?)\b/i, 'force-push rewrites remote history'],
  ['git-hard-reset', /\bgit\s+reset\s+--hard\b/i, 'hard reset discards uncommitted changes'],
  ['git-clean-fd', /\bgit\s+clean\s+-[fFdD]+\b/i, 'git clean -fd removes untracked files'],

  ['drop-database', /\bdrop\s+(database|schema)\b/i, 'DROP DATABASE/SCHEMA wipes data'],
  ['drop-table', /\bdrop\s+table\b/i, 'DROP TABLE wipes a table'],
  ['truncate', /\btruncate\s+(table\s+)?\w+/i, 'TRUNCATE wipes all rows in a table'],

  ['kubectl-delete-pod', /\bkubectl\s+delete\s+(pod|deployment|namespace|ns)\b(?![^]*--dry-run)/i, 'kubectl delete on a live object (use --dry-run)'],
  ['docker-system-prune', /\bdocker\s+system\s+prune\s+-a\b/i, 'docker system prune -a removes all stopped containers and images'],

  ['fork-bomb', /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, 'classic shell fork bomb'],
  ['dd-zero', /\bdd\s+[^|;&]*\bif=\/dev\/zero\b[^|;&]*\bof=\/dev\/(sd|nvme|disk)\b/i, 'dd of=/dev/sd* with /dev/zero bricks the disk'],
  ['chmod-777-recursive', /\bchmod\s+-R\s+777\s+\//, 'recursive chmod 777 on / exposes everything'],
];

const DEFAULT_CONFIG = {
  mode: 'enforce',
  extra_patterns: [],
  allow_overrides: [],
  log: true,
};

function loadConfig() {
  const candidates = [
    process.env.CODEX_TOOLKIT_SHIELD_DESTRUCTIVE_CONFIG,
    path.join(process.cwd(), '.codex-toolkit', 'shield-destructive-cmd.json'),
    path.join(process.env.HOME || '', '.codex', 'shield-destructive-cmd.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        emitError(`shield-destructive-cmd: failed to read ${file}: ${err.message}`);
      }
    }
  }
  return { ...DEFAULT_CONFIG };
}

function compileUserPatterns(patterns) {
  const out = [];
  for (const p of patterns || []) {
    try {
      out.push(new RegExp(p, 'i'));
    } catch (err) {
      emitError(`shield-destructive-cmd: invalid pattern "${p}": ${err.message}`);
    }
  }
  return out;
}

export function evaluate(event) {
  const config = loadConfig();
  if (config.mode === 'off') {
    return { decision: DECISIONS.ALLOW, reason: null, skipped: true };
  }
  if (!SHELL_TOOLS.has(event.toolName)) {
    return { decision: DECISIONS.ALLOW, reason: null, skipped: true };
  }
  const command = extractShellCommand(event.toolInput);
  if (!command) {
    return { decision: DECISIONS.ALLOW, reason: null, skipped: true };
  }

  // Allow overrides match the whole command; if any allow matches, the hook
  // exits early (without consulting the deny list).
  for (const re of compileUserPatterns(config.allow_overrides)) {
    if (re.test(command)) {
      if (config.log) {
        process.stderr.write(`[shield-destructive-cmd] allowed by override: ${command}\n`);
      }
      return { decision: DECISIONS.ALLOW, reason: null, override: true };
    }
  }

  // Deny list: built-in + user extras. Collect all matches for the report.
  const deny = [
    ...DEFAULT_DENY,
    ...compileUserPatterns(config.extra_patterns).map((re, i) => [
      `user-${i}`,
      re,
      'matched a user-defined destructive pattern',
    ]),
  ];
  const hits = [];
  for (const [name, re, why] of deny) {
    if (re.test(command)) hits.push({ name, why });
  }
  if (hits.length === 0) {
    return { decision: DECISIONS.ALLOW, reason: null };
  }
  const summary = hits.map((h) => `  - ${h.name}: ${h.why}`).join('\n');
  const reason = `shield-destructive-cmd: refused command\n    ${command}\nMatched destructive pattern(s):\n${summary}\nIf this is intentional, set "allow_overrides" in .codex-toolkit/shield-destructive-cmd.json.`;
  if (config.log) {
    process.stderr.write(`[shield-destructive-cmd] deny: ${hits.map((h) => h.name).join(', ')}\n`);
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
    emitError(`shield-destructive-cmd: ${parsed.error}`);
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
  process.argv[1]?.endsWith('shield-destructive-cmd.js');
if (isMain) {
  main().catch((err) => emitError(err.stack || err.message));
}

export default { evaluate };
