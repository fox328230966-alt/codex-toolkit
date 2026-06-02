// tool-pace-check — slow Codex down when it tries to chain many tool calls
// in a short window.
//
// The failure mode this targets: the model gets into a "just one more thing"
// loop — read, edit, run, edit, run, edit, run — without stopping to reflect
// or check in. Each individual call looks reasonable; the *pattern* is what
// hurts. By the time the user looks up, five files have been silently
// rewritten and the original task is buried in noise.
//
// We count tool calls per session in a sliding time window. When the count
// crosses the configured threshold, we ask the user to confirm before
// continuing.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  DECISIONS,
  emitDecision,
  emitError,
  parseHookInput,
} from './hook-protocol.js';
import { readState, resolveStateFile, sessionKey, updateState } from './state-store.js';

const DEFAULT_CONFIG = {
  mode: 'enforce', // 'enforce' | 'ask' | 'off'
  max_calls_in_window: 8, // N tool calls
  window_seconds: 60, // over the last K seconds
  log: true,
};

function loadConfig() {
  const candidates = [
    process.env.CODEX_TOOLKIT_TOOL_PACE_CONFIG,
    path.join(process.cwd(), '.codex-toolkit', 'tool-pace.json'),
    path.join(process.env.HOME || '', '.codex', 'tool-pace.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        emitError(`tool-pace-check: failed to read ${file}: ${err.message}`);
      }
    }
  }
  return { ...DEFAULT_CONFIG };
}

function pruneOldTimestamps(calls, windowMs, now) {
  return calls.filter((t) => now - t <= windowMs);
}

export function evaluate(event) {
  const config = loadConfig();
  if (config.mode === 'off') {
    return { decision: DECISIONS.ALLOW, reason: null, skipped: true };
  }

  const stateFile = resolveStateFile('tool-pace');
  const key = sessionKey(event);
  const windowMs = config.window_seconds * 1000;
  const now = Date.now();

  const state = updateState(
    stateFile,
    (s) => {
      s.sessions = s.sessions || {};
      const sess = s.sessions[key] || { calls: [] };
      sess.calls = pruneOldTimestamps(sess.calls, windowMs, now);
      sess.calls.push(now);
      s.sessions[key] = sess;
      return s;
    },
    { sessions: {} }
  );

  const sess = state.sessions[key] || { calls: [] };
  const callCount = sess.calls.length;
  if (config.log) {
    process.stderr.write(
      `[tool-pace-check] tool=${event.toolName ?? '(unknown)'} calls-in-window=${callCount}/${config.max_calls_in_window}\n`
    );
  }
  if (callCount <= config.max_calls_in_window) {
    return { decision: DECISIONS.ALLOW, reason: null, stats: { callCount } };
  }

  // Threshold exceeded.
  const reason = `tool-pace-check: ${callCount} tool calls in the last ${config.window_seconds}s (limit ${config.max_calls_in_window}). Codex may be in a runaway-edit loop.`;
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
    emitError(`tool-pace-check: ${parsed.error}`);
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
  process.argv[1]?.endsWith('tool-pace-check.js');
if (isMain) {
  main().catch((err) => emitError(err.stack || err.message));
}

export default { evaluate };
