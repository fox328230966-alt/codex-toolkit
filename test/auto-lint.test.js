import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evaluate, langFor } from '../src/auto-lint.js';
import { DECISIONS } from '../src/hook-protocol.js';

function freshConfig(config) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ct-al-'));
  const cfgFile = path.join(dir, 'auto-lint.json');
  writeFileSync(cfgFile, JSON.stringify(config));
  process.env.CODEX_TOOLKIT_AUTO_LINT_CONFIG = cfgFile;
  return dir;
}
function cleanup(dir) {
  delete process.env.CODEX_TOOLKIT_AUTO_LINT_CONFIG;
  rmSync(dir, { recursive: true, force: true });
}
function makeEvent(toolName, filePath, content = '') {
  return {
    eventName: 'PostToolUse',
    toolName,
    toolInput: { file_path: filePath, content },
    cwd: process.cwd(),
    raw: {},
  };
}

test('langFor maps common file extensions', () => {
  assert.equal(langFor('foo.go'), 'go');
  assert.equal(langFor('foo.py'), 'py');
  assert.equal(langFor('foo.pyi'), 'py');
  assert.equal(langFor('foo.ts'), 'ts');
  assert.equal(langFor('foo.tsx'), 'ts');
  assert.equal(langFor('foo.jsx'), 'js');
  assert.equal(langFor('foo.rs'), 'rs');
  assert.equal(langFor('foo.md'), null);
  assert.equal(langFor('README'), null);
});

test('non-mutating tools are passed through', async () => {
  const dir = freshConfig({});
  try {
    const r = await evaluate(makeEvent('shell', 'main.go'));
    assert.equal(r.decision, DECISIONS.ALLOW);
    assert.equal(r.skipped, true);
  } finally {
    cleanup(dir);
  }
});

test('unrecognized file extensions are passed through', async () => {
  const dir = freshConfig({});
  try {
    const r = await evaluate(makeEvent('write_file', 'docs/notes.md'));
    assert.equal(r.decision, DECISIONS.ALLOW);
    assert.equal(r.skipped, true);
  } finally {
    cleanup(dir);
  }
});

test('mode=off short-circuits everything', async () => {
  const dir = freshConfig({ mode: 'off' });
  try {
    const r = await evaluate(makeEvent('write_file', 'main.go', 'package main\n'));
    assert.equal(r.decision, DECISIONS.ALLOW);
    assert.equal(r.skipped, true);
  } finally {
    cleanup(dir);
  }
});

test('fallback=allow when linter binary is missing', async () => {
  const dir = freshConfig({
    fallback: 'allow',
    linters: {
      // Use a definitely-missing binary
      go: { cmd: ['__nonexistent_linter_for_test__', '-l'], timeout_ms: 1000 },
    },
  });
  try {
    const r = await evaluate(makeEvent('write_file', 'main.go', 'package main\n'));
    assert.equal(r.decision, DECISIONS.ALLOW);
    assert.equal(r.skipped, 'linter-missing');
  } finally {
    cleanup(dir);
  }
});

test('fallback=deny when linter binary is missing', async () => {
  const dir = freshConfig({
    fallback: 'deny',
    linters: {
      go: { cmd: ['__nonexistent_linter_for_test__', '-l'], timeout_ms: 1000 },
    },
  });
  try {
    const r = await evaluate(makeEvent('write_file', 'main.go', 'package main\n'));
    assert.equal(r.decision, DECISIONS.DENY);
    assert.match(r.reason, /not installed/);
  } finally {
    cleanup(dir);
  }
});

test('clean Go file passes the real gofmt linter', async () => {
  // This test only runs if `gofmt` is on PATH. Otherwise it skips.
  if (!hasBinary('gofmt')) {
    return; // skip silently
  }
  const dir = freshConfig({});
  try {
    const clean = 'package main\n\nfunc main() {}\n';
    const r = await evaluate(makeEvent('write_file', 'main.go', clean));
    assert.equal(r.decision, DECISIONS.ALLOW);
  } finally {
    cleanup(dir);
  }
});

test('unformatted Go file is denied by real gofmt linter', async () => {
  if (!hasBinary('gofmt')) return;
  const dir = freshConfig({});
  try {
    // gofmt requires a tab-indented main() — this is wrong (3 spaces).
    const bad = 'package main\n\nfunc main() {\n   println("hi")\n}\n';
    const r = await evaluate(makeEvent('write_file', 'main.go', bad));
    assert.equal(r.decision, DECISIONS.DENY);
    assert.match(r.reason, /gofmt|issues/i);
  } finally {
    cleanup(dir);
  }
});

test('lint timeout turns the decision into ASK', async () => {
  if (!hasBinary('sleep')) return;
  const dir = freshConfig({
    linters: {
      go: { cmd: ['sleep', '5'], timeout_ms: 100 },
    },
  });
  try {
    const r = await evaluate(makeEvent('write_file', 'main.go', 'package main\n'));
    assert.equal(r.decision, DECISIONS.ASK);
    assert.match(r.reason, /timed out/);
  } finally {
    cleanup(dir);
  }
});

function hasBinary(name) {
  // Cheap check: try to run `which`.
  try {
    const { spawnSync } = require('node:child_process');
    const p = spawnSync('which', [name], { encoding: 'utf8' });
    return p.status === 0 && !!p.stdout.trim();
  } catch {
    return false;
  }
}
