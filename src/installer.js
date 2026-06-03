// codex-toolkit — installer and CLI.
//
// Subcommands:
//   init      install the bundled hooks into ~/.codex/ (user-level)
//   list      show installed hooks and their current state
//   doctor    sanity-check the install (config files, executables, permissions)
//   uninstall remove every file this tool wrote

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const HOOKS_DIR = path.join(PKG_ROOT, 'src');

const CODEX_HOME =
  process.env.CODEX_HOME ||
  path.join(os.homedir(), '.codex');

const HOOKS_INSTALLED = path.join(CODEX_HOME, 'hooks');
const HOOKS_CONFIG = path.join(CODEX_HOME, 'hooks.json');
const HOOKS_CONFIG_TOML = path.join(CODEX_HOME, 'config.toml');

// Bundled hooks (relative to src/).
const BUNDLED = [
  {
    id: 'scope-guard',
    file: 'scope-guard.js',
    event: 'PreToolUse',
    description: 'Block file edits outside the declared task scope.',
  },
  {
    id: 'diff-budget',
    file: 'diff-budget.js',
    event: 'PostToolUse',
    description: 'Refuse writes that exceed a per-task file/byte budget.',
  },
  {
    id: 'tool-pace-check',
    file: 'tool-pace-check.js',
    event: 'PreToolUse',
    description: 'Slow Codex down when it chains many tool calls in a short window.',
  },
  {
    id: 'shield-destructive-cmd',
    file: 'shield-destructive-cmd.js',
    event: 'PreToolUse',
    description: 'Refuse shell commands that can destroy the project (rm -rf, force push, drop table, etc.).',
  },
  {
    id: 'shield-env-guard',
    file: 'shield-env-guard.js',
    event: 'PreToolUse',
    description: 'Refuse writes to .env, SSH keys, cloud creds, and other sensitive files.',
  },
  {
    id: 'auto-lint',
    file: 'auto-lint.js',
    event: 'PostToolUse',
    description: 'Run the right linter (gofmt/ruff/eslint/rustfmt) on every file Codex touches.',
  },
];

// --- helpers -----------------------------------------------------------------

function log(msg) {
  process.stdout.write(`[codex-toolkit] ${msg}\n`);
}
function warn(msg) {
  process.stderr.write(`[codex-toolkit] WARN: ${msg}\n`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function copyHook(file) {
  const src = path.join(HOOKS_DIR, file);
  const dst = path.join(HOOKS_INSTALLED, file);
  fs.copyFileSync(src, dst);
  fs.chmodSync(dst, 0o755);
  return dst;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
}

// Generate a TOML fragment that declares the hooks. We append (not overwrite)
// so existing user config is preserved. If the user has no config.toml at
// all we create a minimal one.
function patchConfigToml(hookEntries) {
  let existing = '';
  try {
    existing = fs.readFileSync(HOOKS_CONFIG_TOML, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  if (existing.includes('[hooks]')) {
    log(`[hooks] section already present in ${HOOKS_CONFIG_TOML} — leaving as-is.`);
    return { status: 'skipped', reason: 'hooks section exists' };
  }

  const header =
    '# Added by codex-toolkit — do not edit by hand unless you know what you are doing.\n';
  const lines = ['[hooks]'];
  for (const entry of hookEntries) {
    const cmd = entry.command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    lines.push(`"${entry.event}" = [{ command = "${cmd}", timeout = 30 }]`);
  }
  const fragment = header + lines.join('\n') + '\n';

  const next = existing.endsWith('\n') || existing === ''
    ? existing + fragment
    : existing + '\n' + fragment;

  fs.writeFileSync(HOOKS_CONFIG_TOML, next, { mode: 0o600 });
  return { status: 'written', file: HOOKS_CONFIG_TOML };
}

// --- subcommands -------------------------------------------------------------

export function install({ dryRun = false, scope = 'user' } = {}) {
  if (scope !== 'user') {
    warn(`Only --scope=user is supported in this version.`);
  }
  log(`Installing into ${CODEX_HOME}`);

  ensureDir(CODEX_HOME);
  ensureDir(HOOKS_INSTALLED);

  const entries = [];
  for (const hook of BUNDLED) {
    if (dryRun) {
      log(`(dry-run) would install ${hook.id} -> ${HOOKS_INSTALLED}/${hook.file}`);
    } else {
      const dst = copyHook(hook.file);
      log(`installed ${hook.id} -> ${dst}`);
    }
    entries.push({
      event: hook.event,
      command: `node ${path.join(HOOKS_INSTALLED, hook.file)}`,
      id: hook.id,
    });
  }

  if (!dryRun) {
    const hooksJson = readJson(HOOKS_CONFIG) || { hooks: {} };
    hooksJson.hooks = hooksJson.hooks || {};
    for (const entry of entries) {
      hooksJson.hooks[entry.event] = hooksJson.hooks[entry.event] || [];
      // Don't double-register.
      const dup = hooksJson.hooks[entry.event].some(
        (e) => e?.command === entry.command
      );
      if (!dup) {
        hooksJson.hooks[entry.event].push({
          type: 'command',
          command: entry.command,
        });
      }
    }
    writeJson(HOOKS_CONFIG, hooksJson);
    log(`wrote ${HOOKS_CONFIG}`);

    try {
      const result = patchConfigToml(entries);
      if (result.status === 'written') {
        log(`appended [hooks] to ${result.file}`);
      }
    } catch (err) {
      warn(`could not patch config.toml (${err.message}). ${HOOKS_CONFIG} still works.`);
    }
  }

  log('Done. Next: run `codex-toolkit list` to verify, then `codex-toolkit doctor`.');
}

export function list() {
  log(`Codex home: ${CODEX_HOME}`);
  for (const hook of BUNDLED) {
    const dst = path.join(HOOKS_INSTALLED, hook.file);
    const exists = fs.existsSync(dst);
    const stats = exists ? fs.statSync(dst) : null;
    log(
      `  ${hook.id.padEnd(20)} ${exists ? 'OK ' : 'MISSING'}  ${dst}` +
        (stats ? `  (${stats.size} bytes)` : '')
    );
  }
  const cfg = readJson(HOOKS_CONFIG);
  if (cfg) {
    log(`  hooks.json:        ${HOOKS_CONFIG}`);
  } else {
    warn(`no ${HOOKS_CONFIG} found. Run \`codex-toolkit init\`.`);
  }
}

export function doctor() {
  const checks = [];
  checks.push({
    name: 'Node version >= 18',
    ok: Number(process.versions.node.split('.')[0]) >= 18,
    detail: process.version,
  });
  checks.push({
    name: '~/.codex exists',
    ok: fs.existsSync(CODEX_HOME),
    detail: CODEX_HOME,
  });
  checks.push({
    name: 'hooks.json present',
    ok: Boolean(readJson(HOOKS_CONFIG)),
    detail: HOOKS_CONFIG,
  });
  for (const hook of BUNDLED) {
    const dst = path.join(HOOKS_INSTALLED, hook.file);
    let ok = false;
    let detail = dst;
    try {
      const stats = fs.statSync(dst);
      ok = stats.isFile();
      detail += ` (${stats.size} bytes)`;
    } catch {
      detail += ' (missing)';
    }
    checks.push({ name: `hook installed: ${hook.id}`, ok, detail });
  }
  let allOk = true;
  for (const c of checks) {
    log(`${c.ok ? 'OK  ' : 'FAIL'}  ${c.name.padEnd(34)} ${c.detail}`);
    if (!c.ok) allOk = false;
  }
  // Smoke test: run scope-guard with a sample event.
  try {
    const sample = JSON.stringify({
      event: 'PreToolUse',
      tool_name: 'write_file',
      tool_input: { file_path: 'src/api/handlers/auth.ts' },
    });
    const proc = spawnSync(
      'node',
      [path.join(HOOKS_INSTALLED, 'scope-guard.js')],
      { input: sample, encoding: 'utf8' }
    );
    log(`smoke test: scope-guard stdout=${proc.stdout.trim() || '(empty)'} stderr=${proc.stderr.trim() || '(empty)'} exit=${proc.status}`);
  } catch (err) {
    warn(`smoke test failed: ${err.message}`);
  }
  if (!allOk) {
    process.exitCode = 1;
  }
}

export function uninstall() {
  for (const hook of BUNDLED) {
    const dst = path.join(HOOKS_INSTALLED, hook.file);
    if (fs.existsSync(dst)) {
      fs.unlinkSync(dst);
      log(`removed ${dst}`);
    }
  }
  log('Uninstall complete. Manual cleanup: edit ' + HOOKS_CONFIG_TOML + ' and ' + HOOKS_CONFIG);
}

// --- CLI dispatcher ----------------------------------------------------------

function main() {
  const [, , subcommand, ...rest] = process.argv;
  const flags = new Set(rest);
  switch (subcommand) {
    case 'init':
      return install({ dryRun: flags.has('--dry-run') });
    case 'list':
      return list();
    case 'doctor':
      return doctor();
    case 'uninstall':
      return uninstall();
    case 'version':
    case '--version':
    case '-v':
      log(JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version);
      return;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      log(
        [
          'codex-toolkit <command>',
          '',
          'Commands:',
          '  init       install hooks into ~/.codex/',
          '  list       show installed hooks and config',
          '  doctor     run sanity checks + smoke test',
          '  uninstall  remove installed hooks',
          '  version    print the version',
          '',
          'Flags:',
          '  --dry-run  show what `init` would do without touching the filesystem',
        ].join('\n')
      );
      return;
    default:
      warn(`unknown command: ${subcommand}. Try \`codex-toolkit help\`.`);
      process.exitCode = 2;
  }
}

// Export main so bin/codex-toolkit.js can invoke it explicitly. (The
// previous top-level "am I the entry point?" check was unreliable: when
// invoked through `npx codex-toolkit …`, process.argv[1] points at the
// npx launcher, not at this file, so the check silently returned false
// and the CLI produced no output.)
export { main };

// Fallback for direct invocation: `node src/installer.js` (used in unit
// tests and local debugging). When loaded via the bin, the IIFE in
// bin/codex-toolkit.js handles the call — and we must NOT also fire here,
// otherwise every command runs twice.
const __filename = fileURLToPath(import.meta.url);
const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPoint && entryPoint === __filename) {
  main();
}
