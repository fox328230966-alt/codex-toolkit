import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluate } from '../src/tool-pace-check.js';
import { DECISIONS } from '../src/hook-protocol.js';

function freshConfig(config) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ct-tp-'));
  const cfgFile = path.join(dir, 'tool-pace.json');
  writeFileSync(cfgFile, JSON.stringify(config));
  process.env.CODEX_TOOLKIT_TOOL_PACE_CONFIG = cfgFile;
  const stateDir = mkdtempSync(path.join(tmpdir(), 'ct-tp-state-'));
  process.env.CODEX_HOME = stateDir;
  return { dir, stateDir };
}

function cleanup(fx) {
  delete process.env.CODEX_TOOLKIT_TOOL_PACE_CONFIG;
  delete process.env.CODEX_HOME;
  rmSync(fx.dir, { recursive: true, force: true });
  rmSync(fx.stateDir, { recursive: true, force: true });
  try {
    rmSync(resolveStateFile('tool-pace'), { force: true });
  } catch { /* ignore */ }
}

function makeEvent(toolName) {
  return {
    eventName: 'PreToolUse',
    toolName,
    toolInput: {},
    cwd: process.cwd(),
    raw: { session_id: 'pace-test-session' },
  };
}

test('allows up to max_calls_in_window calls', () => {
  const fx = freshConfig({ max_calls_in_window: 3, window_seconds: 60 });
  try {
    for (let i = 0; i < 3; i++) {
      const r = evaluate(makeEvent('shell'));
      assert.equal(r.decision, DECISIONS.ALLOW);
    }
  } finally {
    cleanup(fx);
  }
});

test('denies on the call that crosses the threshold', () => {
  const fx = freshConfig({ max_calls_in_window: 3, window_seconds: 60 });
  try {
    for (let i = 0; i < 3; i++) evaluate(makeEvent('shell'));
    const r = evaluate(makeEvent('shell'));
    assert.equal(r.decision, DECISIONS.DENY);
    assert.match(r.reason, /runaway-edit loop/);
  } finally {
    cleanup(fx);
  }
});

test('mode=ask turns deny into ask', () => {
  const fx = freshConfig({ mode: 'ask', max_calls_in_window: 2, window_seconds: 60 });
  try {
    evaluate(makeEvent('shell'));
    evaluate(makeEvent('shell'));
    const r = evaluate(makeEvent('shell'));
    assert.equal(r.decision, DECISIONS.ASK);
  } finally {
    cleanup(fx);
  }
});

test('old timestamps fall out of the window', async () => {
  const fx = freshConfig({ max_calls_in_window: 2, window_seconds: 0 });
  try {
    // window_seconds=0 means: nothing is ever "in the window" beyond the
    // current millisecond, so every call should be allowed.
    for (let i = 0; i < 5; i++) {
      const r = evaluate(makeEvent('shell'));
      assert.equal(r.decision, DECISIONS.ALLOW);
      // Tiny sleep so timestamps differ.
      await new Promise((res) => setTimeout(res, 2));
    }
  } finally {
    cleanup(fx);
  }
});
