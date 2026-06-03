// auto-lint — run the right linter on the file Codex just touched.
//
// Scope-guard controls *where* Codex may edit. diff-budget controls *how
// much*. auto-lint controls *what quality the result is in*: every time
// Codex writes a source file, the right linter runs against it before the
// tool call is allowed to fully complete. If the linter reports issues,
// the hook returns a deny decision that pushes the model's next turn
// toward fixing them.
//
// Detection is by file extension. Defaults are conservative and cover
// the languages we actually care about (Go, Python, JS/TS, Rust). Users
// can override per-linter command and timeout via config.
//
// Triggers on PostToolUse for file-mutating tools.
// Configuration: <cwd>/.codex-toolkit/auto-lint.json
//   {
//     "mode": "enforce" | "ask" | "off",
//     "linters": {
//       "go":   { "cmd": ["gofmt", "-l"], "timeout_ms": 5000 },
//       "py":   { "cmd": ["ruff", "check", "--stdin-display-path", "-"], "timeout_ms": 10000 },
//       "ts":   { "cmd": ["eslint", "--no-warn-ignored", "--stdin"], "timeout_ms": 15000 }
//     },
//     "fallback": "allow"   // what to do when the linter binary is missing
//   }

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import {
  DECISIONS,
  FILE_MUTATING_TOOLS,
  emitDecision,
  emitError,
  extractTargetPath,
  parseHookInput,
} from './hook-protocol.js';

const EXT_TO_LANG = {
  '.go': 'go',
  '.py': 'py',
  '.pyi': 'py',
  '.ts': 'ts',
  '.tsx': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.js': 'js',
  '.jsx': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.rs': 'rs',
};

// Default linter invocations. We feed the *file content* on stdin where the
// linter supports it, and pass the file path as a positional argument. We
// always pass through stderr; we treat non-empty stdout as a "lint issues
// found" signal. Exit code non-zero with empty stdout is also "issues".
const DEFAULT_LINTERS = {
  go: { cmd: ['gofmt', '-l'], timeout_ms: 5000 },
  py: { cmd: ['ruff', 'check', '--stdin-display-path', 'PLACEHOLDER', '-'], timeout_ms: 10000 },
  ts: { cmd: ['eslint', '--no-warn-ignored', '--stdin', '--stdin-filename', 'PLACEHOLDER'], timeout_ms: 15000 },
  js: { cmd: ['eslint', '--no-warn-ignored', '--stdin', '--stdin-filename', 'PLACEHOLDER'], timeout_ms: 15000 },
  rs: { cmd: ['rustfmt', '--check'], timeout_ms: 10000 },
};

const DEFAULT_CONFIG = {
  mode: 'enforce',
  linters: {},
  fallback: 'allow', // 'allow' | 'deny' — when the linter binary is missing
  log: true,
};

function loadConfig() {
  const candidates = [
    process.env.CODEX_TOOLKIT_AUTO_LINT_CONFIG,
    path.join(process.cwd(), '.codex-toolkit', 'auto-lint.json'),
    path.join(process.env.HOME || '', '.codex', 'auto-lint.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        linters: { ...DEFAULT_LINTERS, ...(parsed.linters || {}) },
      };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        emitError(`auto-lint: failed to read ${file}: ${err.message}`);
      }
    }
  }
  return { ...DEFAULT_CONFIG, linters: DEFAULT_LINTERS };
}

export function langFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANG[ext] || null;
}

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function runLinter(cmd, timeoutMs, stdinContent) {
  return new Promise((resolve) => {
    const proc = spawn(cmd[0], cmd.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      proc.kill('SIGKILL');
      resolve({ ok: false, reason: 'timeout', stdout, stderr });
    }, timeoutMs);
    proc.stdout.on('data', (b) => (stdout += b.toString()));
    proc.stderr.on('data', (b) => (stderr += b.toString()));
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, reason: 'spawn-error', error: err.code || err.message, stdout, stderr });
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: true, code, stdout, stderr });
    });
    if (stdinContent !== null && stdinContent !== undefined) {
      proc.stdin.write(stdinContent);
    }
    proc.stdin.end();
  });
}

function substitutePlaceholder(cmd, replacement) {
  return cmd.map((arg) => (arg === 'PLACEHOLDER' ? replacement : arg));
}

export async function evaluate(event) {
  const config = loadConfig();
  if (config.mode === 'off') {
    return { decision: DECISIONS.ALLOW, reason: null, skipped: true };
  }
  if (!FILE_MUTATING_TOOLS.has(event.toolName)) {
    return { decision: DECISIONS.ALLOW, reason: null, skipped: true };
  }
  const target = extractTargetPath(event.toolInput);
  if (!target) {
    return { decision: DECISIONS.ALLOW, reason: null, skipped: true };
  }
  const lang = langFor(target);
  if (!lang) {
    return { decision: DECISIONS.ALLOW, reason: null, skipped: true };
  }
  const linter = config.linters[lang];
  if (!linter) {
    return { decision: DECISIONS.ALLOW, reason: null, skipped: true };
  }

  // Build the actual command (substitute placeholder with the target file)
  // and figure out the stdin content (read the freshly-written file, or fall
  // back to the inline content the tool input may carry).
  const cmd = substitutePlaceholder(linter.cmd, target);
  const inline = event.toolInput?.content ?? event.toolInput?.new_string ?? null;
  const fileContent = readFileIfExists(target);
  const stdin = fileContent !== null ? fileContent : inline;

  const result = await runLinter(cmd, linter.timeout_ms ?? 10000, stdin);

  if (!result.ok) {
    if (result.reason === 'spawn-error' && (result.error === 'ENOENT' || /not found/i.test(result.stderr || ''))) {
      // Linter not installed.
      if (config.fallback === 'deny') {
        return {
          decision: DECISIONS.DENY,
          reason: `auto-lint: linter for .${lang} (${cmd[0]}) is not installed on this machine and fallback is "deny".`,
        };
      }
      if (config.log) {
        process.stderr.write(`[auto-lint] ${lang} linter (${cmd[0]}) not found, allowing (fallback=allow)\n`);
      }
      return { decision: DECISIONS.ALLOW, reason: null, skipped: 'linter-missing' };
    }
    if (result.reason === 'timeout') {
      return {
        decision: DECISIONS.ASK,
        reason: `auto-lint: ${lang} linter timed out after ${linter.timeout_ms}ms. Allow the change without linting?`,
      };
    }
    return {
      decision: DECISIONS.ASK,
      reason: `auto-lint: ${lang} linter failed to run: ${result.error || 'unknown'}`,
    };
  }

  // Linter ran. Decide based on its output.
  const issues = (result.stdout || '').trim();
  if (result.code === 0 && !issues) {
    if (config.log) {
      process.stderr.write(`[auto-lint] ${lang} ${target} -> clean\n`);
    }
    return { decision: DECISIONS.ALLOW, reason: null };
  }
  // Non-zero exit OR non-empty stdout = linter found something.
  const reason =
    `auto-lint: ${lang} linter reported issues in ${target}\n` +
    (issues ? `--- stdout ---\n${issues}\n` : '') +
    (result.stderr ? `--- stderr ---\n${result.stderr}\n` : '') +
    `\nFix the issues (or run the linter manually) and re-apply the change.`;
  if (config.log) {
    process.stderr.write(`[auto-lint] ${lang} ${target} -> issues found\n`);
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
    emitError(`auto-lint: ${parsed.error}`);
    return;
  }
  const result = await evaluate(parsed);
  emitDecision(result.decision, result.reason);
  if (result.decision === DECISIONS.DENY) {
    process.exit(2);
  }
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('auto-lint.js');
if (isMain) {
  main().catch((err) => emitError(err.stack || err.message));
}

export default { evaluate, langFor, runLinter };
