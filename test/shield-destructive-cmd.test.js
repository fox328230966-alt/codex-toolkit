import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluate } from '../src/shield-destructive-cmd.js';
import { DECISIONS } from '../src/hook-protocol.js';

function freshConfig(config) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ct-sd-'));
  const cfgFile = path.join(dir, 'shield-destructive-cmd.json');
  writeFileSync(cfgFile, JSON.stringify(config));
  process.env.CODEX_TOOLKIT_SHIELD_DESTRUCTIVE_CONFIG = cfgFile;
  return dir;
}
function cleanup(dir) {
  delete process.env.CODEX_TOOLKIT_SHIELD_DESTRUCTIVE_CONFIG;
  rmSync(dir, { recursive: true, force: true });
}
function makeEvent(toolName, command) {
  return {
    eventName: 'PreToolUse',
    toolName,
    toolInput: { command },
    cwd: process.cwd(),
    raw: {},
  };
}

test('allows benign shell commands', () => {
  const dir = freshConfig({});
  try {
    for (const cmd of ['ls -la', 'git status', 'npm test', 'echo hello', 'go build ./...']) {
      const r = evaluate(makeEvent('shell', cmd));
      assert.equal(r.decision, DECISIONS.ALLOW, `should allow: ${cmd}`);
    }
  } finally {
    cleanup(dir);
  }
});

test('denies rm -rf on root', () => {
  const dir = freshConfig({});
  try {
    const r = evaluate(makeEvent('shell', 'rm -rf /'));
    assert.equal(r.decision, DECISIONS.DENY);
    assert.match(r.reason, /recursively deleting root/);
  } finally {
    cleanup(dir);
  }
});

test('denies rm -rf on home', () => {
  const dir = freshConfig({});
  try {
    const r = evaluate(makeEvent('shell', 'rm -rf ~'));
    assert.equal(r.decision, DECISIONS.DENY);
    assert.match(r.reason, /home directory/);
  } finally {
    cleanup(dir);
  }
});

test('denies git push --force', () => {
  const dir = freshConfig({});
  try {
    const r = evaluate(makeEvent('shell', 'git push --force origin main'));
    assert.equal(r.decision, DECISIONS.DENY);
    assert.match(r.reason, /force-push/);
  } finally {
    cleanup(dir);
  }
});

test('denies git reset --hard', () => {
  const dir = freshConfig({});
  try {
    const r = evaluate(makeEvent('shell', 'git reset --hard HEAD~5'));
    assert.equal(r.decision, DECISIONS.DENY);
    assert.match(r.reason, /hard reset/);
  } finally {
    cleanup(dir);
  }
});

test('denies drop database and drop table', () => {
  const dir = freshConfig({});
  try {
    assert.equal(evaluate(makeEvent('shell', 'DROP DATABASE prod;')).decision, DECISIONS.DENY);
    assert.equal(evaluate(makeEvent('shell', 'drop table users;')).decision, DECISIONS.DENY);
  } finally {
    cleanup(dir);
  }
});

test('denies kubectl delete pod without --dry-run', () => {
  const dir = freshConfig({});
  try {
    assert.equal(evaluate(makeEvent('shell', 'kubectl delete pod api-1')).decision, DECISIONS.DENY);
    assert.equal(
      evaluate(makeEvent('shell', 'kubectl delete pod api-1 --dry-run=client')).decision,
      DECISIONS.ALLOW
    );
  } finally {
    cleanup(dir);
  }
});

test('extra_patterns extends the deny list', () => {
  const dir = freshConfig({ extra_patterns: ['\\bterraform\\s+destroy\\b'] });
  try {
    const r = evaluate(makeEvent('shell', 'terraform destroy -auto-approve'));
    assert.equal(r.decision, DECISIONS.DENY);
    assert.match(r.reason, /user-0/);
  } finally {
    cleanup(dir);
  }
});

test('allow_overrides bypasses the deny list', () => {
  const dir = freshConfig({ allow_overrides: ['^git\\s+push\\s+--force\\s+to-my-personal-fork'] });
  try {
    const r = evaluate(makeEvent('shell', 'git push --force to-my-personal-fork main'));
    assert.equal(r.decision, DECISIONS.ALLOW);
    assert.equal(r.override, true);
  } finally {
    cleanup(dir);
  }
});

test('mode=ask turns deny into ask', () => {
  const dir = freshConfig({ mode: 'ask' });
  try {
    const r = evaluate(makeEvent('shell', 'rm -rf /'));
    assert.equal(r.decision, DECISIONS.ASK);
  } finally {
    cleanup(dir);
  }
});

test('non-shell tools are passed through', () => {
  const dir = freshConfig({});
  try {
    const r = evaluate(makeEvent('write_file', 'rm -rf /'));
    assert.equal(r.decision, DECISIONS.ALLOW);
  } finally {
    cleanup(dir);
  }
});
