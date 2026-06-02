import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluate } from '../src/shield-env-guard.js';
import { DECISIONS } from '../src/hook-protocol.js';

function freshConfig(config) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ct-se-'));
  const cfgFile = path.join(dir, 'shield-env-guard.json');
  writeFileSync(cfgFile, JSON.stringify(config));
  process.env.CODEX_TOOLKIT_SHIELD_ENV_CONFIG = cfgFile;
  return dir;
}
function cleanup(dir) {
  delete process.env.CODEX_TOOLKIT_SHIELD_ENV_CONFIG;
  rmSync(dir, { recursive: true, force: true });
}
function makeEvent(toolName, filePath) {
  return {
    eventName: 'PreToolUse',
    toolName,
    toolInput: { file_path: filePath },
    cwd: process.cwd(),
    raw: {},
  };
}

test('allows writes to ordinary source files', () => {
  const dir = freshConfig({});
  try {
    for (const p of [
      'src/main.ts',
      'docs/readme.md',
      'tests/auth.test.js',
      'go.mod',
    ]) {
      const r = evaluate(makeEvent('write_file', p));
      assert.equal(r.decision, DECISIONS.ALLOW, `should allow: ${p}`);
    }
  } finally {
    cleanup(dir);
  }
});

test('denies .env at any depth', () => {
  const dir = freshConfig({});
  try {
    assert.equal(evaluate(makeEvent('write_file', '.env')).decision, DECISIONS.DENY);
    assert.equal(evaluate(makeEvent('write_file', 'apps/api/.env')).decision, DECISIONS.DENY);
    assert.equal(evaluate(makeEvent('write_file', 'apps/api/.env.production')).decision, DECISIONS.DENY);
  } finally {
    cleanup(dir);
  }
});

test('denies SSH keys', () => {
  const dir = freshConfig({});
  try {
    assert.equal(evaluate(makeEvent('write_file', '.ssh/id_rsa')).decision, DECISIONS.DENY);
    assert.equal(evaluate(makeEvent('write_file', 'home/user/.ssh/id_ed25519')).decision, DECISIONS.DENY);
  } finally {
    cleanup(dir);
  }
});

test('denies PEM and key files', () => {
  const dir = freshConfig({});
  try {
    assert.equal(evaluate(makeEvent('write_file', 'certs/site.pem')).decision, DECISIONS.DENY);
    assert.equal(evaluate(makeEvent('write_file', 'keys/api.key')).decision, DECISIONS.DENY);
  } finally {
    cleanup(dir);
  }
});

test('denies package manager token files', () => {
  const dir = freshConfig({});
  try {
    assert.equal(evaluate(makeEvent('write_file', '.npmrc')).decision, DECISIONS.DENY);
    assert.equal(evaluate(makeEvent('write_file', '.pypirc')).decision, DECISIONS.DENY);
    assert.equal(evaluate(makeEvent('write_file', '.netrc')).decision, DECISIONS.DENY);
  } finally {
    cleanup(dir);
  }
});

test('denies writes under secrets/ and credentials/', () => {
  const dir = freshConfig({});
  try {
    assert.equal(evaluate(makeEvent('write_file', 'secrets/api.json')).decision, DECISIONS.DENY);
    assert.equal(evaluate(makeEvent('write_file', 'config/credentials/aws.json')).decision, DECISIONS.DENY);
  } finally {
    cleanup(dir);
  }
});

test('extra_patterns extends the deny list', () => {
  const dir = freshConfig({ extra_patterns: ['**/internal-token*'] });
  try {
    const r = evaluate(makeEvent('write_file', 'config/internal-token.txt'));
    assert.equal(r.decision, DECISIONS.DENY);
    assert.match(r.reason, /internal-token/);
  } finally {
    cleanup(dir);
  }
});

test('allow_overrides bypasses the deny list for a specific file', () => {
  const dir = freshConfig({ allow_overrides: ['docs/.env.example'] });
  try {
    const r = evaluate(makeEvent('write_file', 'docs/.env.example'));
    assert.equal(r.decision, DECISIONS.ALLOW);
    assert.equal(r.override, true);
  } finally {
    cleanup(dir);
  }
});

test('mode=ask turns deny into ask', () => {
  const dir = freshConfig({ mode: 'ask' });
  try {
    const r = evaluate(makeEvent('write_file', '.env'));
    assert.equal(r.decision, DECISIONS.ASK);
  } finally {
    cleanup(dir);
  }
});

test('non-file tools are passed through', () => {
  const dir = freshConfig({});
  try {
    const r = evaluate(makeEvent('shell', 'cat .env'));
    assert.equal(r.decision, DECISIONS.ALLOW);
  } finally {
    cleanup(dir);
  }
});
