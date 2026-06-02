// diff-budget — set a per-task ceiling on how much Codex may change.
//
// Why: scope-guard controls *where* Codex may edit. diff-budget controls
// *how much*. Even within an allowed scope, an agent can quietly rewrite
// half the file or churn 30 files in one turn. This hook catches that.
//
// Two layers of defense, both configurable:
//
// 1. Per-call ceiling (stateless, easy to reason about):
//      max_bytes_per_write  — refuse writes whose input is larger than N bytes.
//
// 2. Per-session ceiling (stateful, file-based counter):
//      max_files_per_task   — refuse once N distinct files have been touched
//                             in the current session.
//      max_total_bytes      — refuse once total bytes written exceeds N.
//
// State persists at <cwd>/.codex-toolkit/.diff-budget.json and is keyed
// by session id (best-effort) or cwd. Reset by deleting the file or
// running `codex-toolkit diff-budget reset`.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  DECISIONS,
  FILE_MUTATING_TOOLS,
  emitDecision,
  emitError,
  parseHookInput,
  extractTargetPath,
} from './hook-protocol.js';
import { readState, resolveStateFile, sessionKey, updateState } from './state-store.js';

const DEFAULT_CONFIG = {
  mode: 'enforce', // 'enforce' | 'ask' | 'off'
  max_bytes_per_write: 100_000, // ~100 KB per single write
  max_files_per_task: 25, // ~distinct files per session
  max_total_bytes: 500_000, // ~500 KB total per session
  log: true,
};

function loadConfig() {
  const candidates = [
    process.env.CODEX_TOOLKIT_DIFF_BUDGET_CONFIG,
    path.join(process.cwd(), '.codex-toolkit', 'diff-budget.json'),
    path.join(process.env.HOME || '', '.codex', 'diff-budget.json'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        emitError(`diff-budget: failed to read ${file}: ${err.message}`);
      }
    }
  }
  return { ...DEFAULT_CONFIG };
}

function byteSizeOfWrite(input) {
  if (!input || typeof input !== 'object') return 0;
  const candidates = [
    input.content,
    input.contents,
    input.new_string,
    input.newString,
    input.text,
    input.body,
    input.patch,
  ];
  for (const c of candidates) {
    if (typeof c === 'string') return Buffer.byteLength(c, 'utf8');
  }
  return 0;
}

function overThreshold(value, limit) {
  return typeof limit === 'number' && limit > 0 && value > limit;
}

function formatReason(kind, current, limit) {
  return `diff-budget: ${kind} (${current}) exceeded limit (${limit}). Increase the limit in .codex-toolkit/diff-budget.json or split the task.`;
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
  const writeBytes = byteSizeOfWrite(event.toolInput);

  // (1) per-call ceiling
  if (overThreshold(writeBytes, config.max_bytes_per_write)) {
    return respond(config, 'deny', formatReason('per-write size', writeBytes, config.max_bytes_per_write));
  }

  // (2) per-session ceiling
  const stateFile = resolveStateFile('diff-budget');
  const key = sessionKey(event);
  const state = updateState(
    stateFile,
    (s) => {
      s.sessions = s.sessions || {};
      const sess = s.sessions[key] || { files: {}, totalBytes: 0 };
      if (target && !sess.files[target]) {
        sess.files[target] = { firstAt: Date.now() };
      }
      sess.totalBytes += writeBytes;
      s.sessions[key] = sess;
      return s;
    },
    { sessions: {} }
  );
  const sess = state.sessions[key] || { files: {}, totalBytes: 0 };
  const fileCount = Object.keys(sess.files).length;

  if (overThreshold(fileCount, config.max_files_per_task)) {
    return respond(config, 'deny', formatReason('files touched this task', fileCount, config.max_files_per_task));
  }
  if (overThreshold(sess.totalBytes, config.max_total_bytes)) {
    return respond(config, 'deny', formatReason('total bytes this task', sess.totalBytes, config.max_total_bytes));
  }

  return { decision: DECISIONS.ALLOW, reason: null, stats: { fileCount, totalBytes: sess.totalBytes } };
}

function respond(config, severity, reason) {
  const decision = severity === 'deny' && config.mode === 'ask' ? DECISIONS.ASK : DECISIONS.DENY;
  if (config.log) {
    process.stderr.write(`[diff-budget] -> ${decision}: ${reason}\n`);
  }
  return { decision, reason };
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
    emitError(`diff-budget: ${parsed.error}`);
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
  process.argv[1]?.endsWith('diff-budget.js');
if (isMain) {
  main().catch((err) => emitError(err.stack || err.message));
}

export default { evaluate };
