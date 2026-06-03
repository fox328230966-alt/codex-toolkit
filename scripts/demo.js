#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-toolkit-demo-'));
const codexHome = path.join(tmp, 'codex-home');
const project = path.join(tmp, 'project');
const toolkitDir = path.join(project, '.codex-toolkit');

fs.mkdirSync(toolkitDir, { recursive: true });
fs.writeFileSync(
  path.join(toolkitDir, 'scope-guard.json'),
  JSON.stringify(
    {
      mode: 'enforce',
      allow: ['src/auth/**', 'tests/auth/**'],
      deny: ['.env', '.env.*', '**/secrets/**'],
      log: false,
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  path.join(toolkitDir, 'diff-budget.json'),
  JSON.stringify(
    {
      mode: 'enforce',
      max_bytes_per_write: 80,
      max_files_per_task: 3,
      max_total_bytes: 200,
      log: false,
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  path.join(toolkitDir, 'shield-env-guard.json'),
  JSON.stringify({ mode: 'enforce', log: false }, null, 2),
);
fs.writeFileSync(
  path.join(toolkitDir, 'shield-destructive-cmd.json'),
  JSON.stringify({ mode: 'enforce', log: false }, null, 2),
);

process.env.CODEX_HOME = codexHome;
process.chdir(project);

const { evaluate: scopeGuard } = await import('../src/scope-guard.js');
const { evaluate: shieldEnvGuard } = await import('../src/shield-env-guard.js');
const { evaluate: shieldDestructiveCmd } = await import('../src/shield-destructive-cmd.js');
const { evaluate: diffBudget } = await import('../src/diff-budget.js');

function event({ eventName = 'PreToolUse', toolName, toolInput }) {
  return {
    eventName,
    toolName,
    toolInput,
    cwd: project,
    raw: { session_id: 'demo-session' },
  };
}

function line(label, result) {
  const decision = result.decision.toUpperCase().padEnd(5);
  const reasonText = result.reason?.replace(/\s+/g, ' ').trim();
  const reason = reasonText ? ` — ${reasonText}` : '';
  process.stdout.write(`${decision} ${label}${reason}\n`);
}

process.stdout.write('codex-toolkit demo: real hook decisions\n');
process.stdout.write('scope: allow src/auth/** and tests/auth/** only\n\n');

line(
  'shield-env-guard write_file(.env)',
  shieldEnvGuard(event({
    toolName: 'write_file',
    toolInput: { file_path: '.env', content: 'OPENAI_API_KEY=...' },
  })),
);

line(
  'scope-guard write_file(README.md)',
  scopeGuard(event({
    toolName: 'write_file',
    toolInput: { file_path: 'README.md', content: '# surprise rewrite\n' },
  })),
);

line(
  'scope-guard write_file(src/auth/login.ts)',
  scopeGuard(event({
    toolName: 'write_file',
    toolInput: { file_path: 'src/auth/login.ts', content: 'export const ok = true;\n' },
  })),
);

line(
  'shield-destructive-cmd shell("git reset --hard")',
  shieldDestructiveCmd(event({
    toolName: 'shell',
    toolInput: { command: 'git reset --hard' },
  })),
);

line(
  'diff-budget write_file(src/auth/large.ts)',
  diffBudget(event({
    eventName: 'PostToolUse',
    toolName: 'write_file',
    toolInput: {
      file_path: 'src/auth/large.ts',
      content: 'x'.repeat(120),
    },
  })),
);

fs.rmSync(tmp, { recursive: true, force: true });
