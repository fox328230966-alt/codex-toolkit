// Tests for scope-guard. Run with `node --test test/`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluate } from '../src/scope-guard.js';
import { DECISIONS } from '../src/hook-protocol.js';

function makeEvent(toolName, filePath) {
  return {
    eventName: 'PreToolUse',
    toolName,
    toolInput: { file_path: filePath },
    cwd: process.cwd(),
    raw: {},
  };
}

function withConfig(config, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ct-scope-'));
  const file = path.join(dir, 'scope-guard.json');
  writeFileSync(file, JSON.stringify(config));
  const prev = process.env.CODEX_TOOLKIT_SCOPE_GUARD_CONFIG;
  process.env.CODEX_TOOLKIT_SCOPE_GUARD_CONFIG = file;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CODEX_TOOLKIT_SCOPE_GUARD_CONFIG;
    else process.env.CODEX_TOOLKIT_SCOPE_GUARD_CONFIG = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('allows non-file tools regardless of scope', () => {
  withConfig({ allow: ['src/**'] }, () => {
    const r = evaluate(makeEvent('shell', 'rm -rf /'));
    assert.equal(r.decision, DECISIONS.ALLOW);
    assert.equal(r.skipped, true);
  });
});

test('default config denies the obvious-dangerous paths out of the box', () => {
  // No user config — the DEFAULT_CONFIG deny list should still fire.
  // This is the v0.4.2 behavior change: a fresh install is no longer
  // wide-open by default.
  const prev = process.env.CODEX_TOOLKIT_SCOPE_GUARD_CONFIG;
  delete process.env.CODEX_TOOLKIT_SCOPE_GUARD_CONFIG;
  try {
    for (const p of ['.env', '.env.production', 'secrets/api.json', '.git/config']) {
      const r = evaluate(makeEvent('write_file', p));
      assert.equal(r.decision, DECISIONS.DENY, `default should deny: ${p}`);
    }
  } finally {
    if (prev !== undefined) process.env.CODEX_TOOLKIT_SCOPE_GUARD_CONFIG = prev;
  }
});

test('denies out-of-scope file edits in enforce mode', () => {
  withConfig({ allow: ['src/auth/**'] }, () => {
    const r = evaluate(makeEvent('write_file', 'src/billing/invoice.ts'));
    assert.equal(r.decision, DECISIONS.DENY);
    assert.match(r.reason, /outside the declared scope/);
  });
});

test('asks the user in ask mode for out-of-scope edits', () => {
  withConfig({ allow: ['src/auth/**'], mode: 'ask' }, () => {
    const r = evaluate(makeEvent('edit_file', 'docs/notes.md'));
    assert.equal(r.decision, DECISIONS.ASK);
    assert.match(r.reason, /Approve this out-of-scope edit/);
  });
});

test('deny patterns override allow', () => {
  withConfig(
    { allow: ['**/*'], deny: ['.env', '**/secrets/**'] },
    () => {
      const r1 = evaluate(makeEvent('write_file', '.env'));
      const r2 = evaluate(makeEvent('write_file', 'config/secrets/api.json'));
      assert.equal(r1.decision, DECISIONS.DENY);
      assert.equal(r2.decision, DECISIONS.DENY);
    }
  );
});

test('matches double-star globs correctly', () => {
  withConfig({ allow: ['src/api/**/*.ts'] }, () => {
    const ok = evaluate(makeEvent('write_file', 'src/api/v1/users.ts'));
    const nope = evaluate(makeEvent('write_file', 'src/api/v1/users.css'));
    assert.equal(ok.decision, DECISIONS.ALLOW);
    assert.equal(nope.decision, DECISIONS.DENY);
  });
});

test('mode=off always allows', () => {
  withConfig({ allow: ['src/**'], mode: 'off' }, () => {
    const r = evaluate(makeEvent('write_file', 'unrelated/place.ts'));
    assert.equal(r.decision, DECISIONS.ALLOW);
  });
});
