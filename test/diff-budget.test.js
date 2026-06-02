import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluate } from '../src/diff-budget.js';
import { DECISIONS } from '../src/hook-protocol.js';
import { resolveStateFile } from '../src/state-store.js';

function freshConfigAndState(config) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ct-db-'));
  const cfgFile = path.join(dir, 'diff-budget.json');
  writeFileSync(cfgFile, JSON.stringify(config));
  process.env.CODEX_TOOLKIT_DIFF_BUDGET_CONFIG = cfgFile;
  // Also redirect state file to a temp dir.
  const stateDir = mkdtempSync(path.join(tmpdir(), 'ct-db-state-'));
  process.env.CODEX_HOME = stateDir;
  return { dir, stateDir };
}

function cleanup(fixture) {
  delete process.env.CODEX_TOOLKIT_DIFF_BUDGET_CONFIG;
  delete process.env.CODEX_HOME;
  rmSync(fixture.dir, { recursive: true, force: true });
  rmSync(fixture.stateDir, { recursive: true, force: true });
  // Best-effort state file cleanup — state-store.js resolves this from cwd
  // by default, so cleanup() must nuke whatever was written there too.
  try {
    rmSync(resolveStateFile('diff-budget'), { force: true });
  } catch { /* ignore */ }
}

function makeEvent(toolName, filePath, content = '') {
  return {
    eventName: 'PostToolUse',
    toolName,
    toolInput: { file_path: filePath, content },
    cwd: process.cwd(),
    raw: { session_id: 'test-session-1' },
  };
}

test('allows small writes inside budget', () => {
  const fx = freshConfigAndState({ max_bytes_per_write: 1000, max_files_per_task: 5 });
  try {
    const r = evaluate(makeEvent('write_file', 'src/a.ts', 'hello'));
    assert.equal(r.decision, DECISIONS.ALLOW);
  } finally {
    cleanup(fx);
  }
});

test('denies a single write that exceeds max_bytes_per_write', () => {
  const fx = freshConfigAndState({ max_bytes_per_write: 100, max_files_per_task: 5 });
  try {
    const r = evaluate(makeEvent('write_file', 'src/big.ts', 'x'.repeat(500)));
    assert.equal(r.decision, DECISIONS.DENY);
    assert.match(r.reason, /per-write size/);
  } finally {
    cleanup(fx);
  }
});

test('counts distinct files across writes and enforces max_files_per_task', () => {
  const fx = freshConfigAndState({ max_bytes_per_write: 10000, max_files_per_task: 3 });
  try {
    for (let i = 0; i < 3; i++) {
      const r = evaluate(makeEvent('write_file', `src/file-${i}.ts`, 'a'));
      assert.equal(r.decision, DECISIONS.ALLOW);
    }
    const r = evaluate(makeEvent('write_file', 'src/file-3.ts', 'a'));
    assert.equal(r.decision, DECISIONS.DENY);
    assert.match(r.reason, /files touched this task/);
  } finally {
    cleanup(fx);
  }
});

test('mode=ask turns deny into ask', () => {
  const fx = freshConfigAndState({ mode: 'ask', max_bytes_per_write: 10 });
  try {
    const r = evaluate(makeEvent('write_file', 'src/big.ts', 'x'.repeat(50)));
    assert.equal(r.decision, DECISIONS.ASK);
  } finally {
    cleanup(fx);
  }
});

test('mode=off skips the hook entirely', () => {
  const fx = freshConfigAndState({ mode: 'off', max_bytes_per_write: 1 });
  try {
    const r = evaluate(makeEvent('write_file', 'src/big.ts', 'x'.repeat(50)));
    assert.equal(r.decision, DECISIONS.ALLOW);
    assert.equal(r.skipped, true);
  } finally {
    cleanup(fx);
  }
});

test('non-file tools are always allowed', () => {
  const fx = freshConfigAndState({ max_files_per_task: 1 });
  try {
    const r = evaluate(makeEvent('shell', 'rm -rf /', 'unused'));
    assert.equal(r.decision, DECISIONS.ALLOW);
  } finally {
    cleanup(fx);
  }
});
