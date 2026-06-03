// Tests for the installer. Run with `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('install copies hooks AND their shared dependencies', () => {
  const codexHome = mkdtempSync(path.join(tmpdir(), 'ct-inst-home-'));
  const prevCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  try {
    const proc = spawnSync('node', ['bin/codex-toolkit.js', 'init'], {
      encoding: 'utf8',
      cwd: path.resolve('.'),
    });
    assert.equal(proc.status, 0, `init exited non-zero: ${proc.stderr}`);
    const installed = readdirSync(path.join(codexHome, 'hooks'));
    for (const hook of [
      'scope-guard.js',
      'diff-budget.js',
      'tool-pace-check.js',
      'shield-destructive-cmd.js',
      'shield-env-guard.js',
      'auto-lint.js',
    ]) {
      assert.ok(existsSync(path.join(codexHome, 'hooks', hook)), `missing: ${hook}`);
    }
    assert.ok(
      existsSync(path.join(codexHome, 'hooks', 'hook-protocol.js')),
      'hook-protocol.js not copied — installed hooks will fail to import',
    );
    assert.ok(
      existsSync(path.join(codexHome, 'hooks', 'state-store.js')),
      'state-store.js not copied — installed hooks will fail to import',
    );
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(codexHome, 'hooks', 'package.json'), 'utf8')),
      { type: 'module' },
      'installed hooks need a package.json so Node 18 treats them as ESM',
    );
  } finally {
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    rmSync(codexHome, { recursive: true, force: true });
  }
});

test('install writes grouped TOML hook entries without duplicate event keys', () => {
  const codexHome = mkdtempSync(path.join(tmpdir(), 'ct-inst-home-'));
  const prevCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  try {
    const proc = spawnSync('node', ['bin/codex-toolkit.js', 'init'], {
      encoding: 'utf8',
      cwd: path.resolve('.'),
    });
    assert.equal(proc.status, 0, `init exited non-zero: ${proc.stderr}`);
    const toml = readFileSync(path.join(codexHome, 'config.toml'), 'utf8');
    assert.equal((toml.match(/^"PreToolUse"\s=/gm) || []).length, 1);
    assert.equal((toml.match(/^"PostToolUse"\s=/gm) || []).length, 1);
    assert.match(toml, /scope-guard\.js.*tool-pace-check\.js.*shield-destructive-cmd\.js.*shield-env-guard\.js/);
    assert.match(toml, /diff-budget\.js.*auto-lint\.js/);
  } finally {
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    rmSync(codexHome, { recursive: true, force: true });
  }
});

test('installed scope-guard actually runs end-to-end (smoke test)', () => {
  const codexHome = mkdtempSync(path.join(tmpdir(), 'ct-inst-home-'));
  const prevCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  try {
    const init = spawnSync('node', ['bin/codex-toolkit.js', 'init'], {
      encoding: 'utf8',
      cwd: path.resolve('.'),
    });
    assert.equal(init.status, 0, `init exited non-zero: ${init.stderr}`);
    const sample = JSON.stringify({
      event: 'PreToolUse',
      tool_name: 'write_file',
      tool_input: { file_path: '.env' },
    });
    const proc = spawnSync(
      'node',
      [path.join(codexHome, 'hooks', 'scope-guard.js')],
      { input: sample, encoding: 'utf8' },
    );
    assert.equal(proc.status, 2, `expected exit 2 (deny), got ${proc.status}\nstderr: ${proc.stderr}`);
    const out = JSON.parse(proc.stdout);
    assert.equal(out.decision, 'deny');
    assert.match(out.reason, /outside the declared scope|deny/);
  } finally {
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    rmSync(codexHome, { recursive: true, force: true });
  }
});
