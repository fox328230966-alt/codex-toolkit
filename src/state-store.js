// state-store — tiny JSON-file-backed key/value store used by hooks that
// need to remember things across hook invocations (diff-budget, tool-pace-check).
//
// Codex invokes each hook as a fresh subprocess, so any in-memory state would
// be lost between calls. We persist to a small JSON file under the user's
// project directory (or CODEX_HOME if no project is found).
//
// All operations are atomic-ish: we read, mutate, write to a temp file, then
// rename. We never partially overwrite. If the file is corrupt, we recover
// gracefully (treat as empty) and back the bad file up to `.corrupt-<ts>`.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');function defaultStateDir() {
  // Tests can override the location via CODEX_HOME. In production we prefer
  // a project-level directory (one .codex-toolkit/ per repo), with CODEX_HOME
  // as the fallback. Reading CODEX_HOME lazily (each call) so test fixtures
  // can set the env var *after* importing this module.
  if (process.env.CODEX_HOME) {
    try {
      fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
      fs.accessSync(process.env.CODEX_HOME, fs.constants.W_OK);
      return process.env.CODEX_HOME;
    } catch {
      /* fall through to project-level */
    }
  }
  const projectDir = path.join(process.cwd(), '.codex-toolkit');
  try {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.accessSync(projectDir, fs.constants.W_OK);
    return projectDir;
  } catch {
    return CODEX_HOME;
  }
}

export function resolveStateFile(name) {
  const safe = String(name).replace(/[^a-z0-9._-]/gi, '_');
  return path.join(defaultStateDir(), `${safe}.json`);
}

export function readState(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    // Corrupt file: back it up, treat as empty.
    try {
      fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      /* swallow */
    }
    return {};
  }
}

export function writeState(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export function updateState(file, mutator, defaultValue = {}) {
  const current = readState(file);
  const next = mutator({ ...defaultValue, ...current }) || current;
  writeState(file, next);
  return next;
}

// Best-effort: extract a session/thread id from the event. We tolerate
// several shapes; if none is present, we fall back to a per-cwd key.
export function sessionKey(event) {
  const candidates = [
    event?.raw?.session_id,
    event?.raw?.thread_id,
    event?.raw?.sessionId,
    event?.raw?.threadId,
    event?.raw?.conversation_id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return `cwd:${process.cwd()}`;
}
