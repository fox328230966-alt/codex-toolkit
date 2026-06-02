// Shared constants and helpers for Codex CLI hooks.
//
// The Codex CLI hook protocol (as observed in the openai/codex feature flag
// "hooks", default-on since v0.50) follows the same shape used by other major
// AI coding CLIs:
//
//   1. Codex invokes a hook as a subprocess and writes a JSON event to its stdin.
//   2. The hook reads the event, decides, and writes a JSON decision to stdout.
//   3. The hook exits:
//        0  -> success, decision in stdout is honored
//        2  -> blocking error, stderr is fed back to the model
//        *  -> non-blocking error, stderr is shown to the user, execution continues
//
// We keep the schema loose (`parseHookInput` tolerates a few common shapes)
// because Codex has not yet published a formal protocol spec; once it does,
// the parser becomes a single-file change without touching any individual hook.

export const HOOK_EVENTS = Object.freeze({
  PRE_TOOL_USE: 'PreToolUse',
  POST_TOOL_USE: 'PostToolUse',
  USER_PROMPT_SUBMIT: 'UserPromptSubmit',
  SESSION_START: 'SessionStart',
  SESSION_END: 'SessionEnd',
});

export const DECISIONS = Object.freeze({
  ALLOW: 'allow',
  DENY: 'deny',
  ASK: 'ask',
});

// Tools that operate on file paths. Used by hooks that care about *where* a
// change is being made (scope-guard, env-guard, auto-lint).
export const FILE_MUTATING_TOOLS = new Set([
  'write_file',
  'edit_file',
  'apply_patch',
  'create_file',
  'patch_file',
  'multi_edit',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
]);

// Tools that run shell commands. Used by hooks that care about *what*
// command is being executed (shield-destructive-cmd, shield-env-guard).
export const SHELL_TOOLS = new Set([
  'shell',
  'bash',
  'exec',
  'Bash',
  'Shell',
]);

// Best-effort extraction of the file path an event is about to mutate.
// Returns `null` if no obvious path is present.
export function extractTargetPath(input) {
  if (!input || typeof input !== 'object') return null;
  const candidates = [
    input.file_path,
    input.path,
    input.filePath,
    input.target_file,
    input.targetPath,
    input?.tool_input?.file_path,
    input?.tool_input?.path,
    input?.tool_input?.filePath,
    input?.tool_input?.target_file,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return null;
}

// Best-effort extraction of the shell command an event is about to run.
export function extractShellCommand(input) {
  if (!input || typeof input !== 'object') return null;
  const candidates = [
    input.command,
    input.cmd,
    input.shell_command,
    input?.tool_input?.command,
    input?.tool_input?.cmd,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return null;
}

// Tolerate several observed JSON shapes. We do not throw on unknown shapes —
// instead we return a `parseHookInput` result with what we could extract.
export function parseHookInput(rawJson) {
  let event = rawJson;
  if (typeof rawJson === 'string') {
    try {
      event = JSON.parse(rawJson);
    } catch {
      return { ok: false, error: 'invalid JSON' };
    }
  }
  if (!event || typeof event !== 'object') {
    return { ok: false, error: 'event is not an object' };
  }

  const eventName =
    event.event ||
    event.hook_event_name ||
    event.type ||
    event.eventName ||
    null;

  const toolName =
    event.tool_name ||
    event.toolName ||
    event?.tool?.name ||
    event?.tool_input?.tool ||
    null;

  const toolInput =
    event.tool_input ||
    event.toolInput ||
    event?.tool?.input ||
    event.input ||
    null;

  const cwd =
    event.cwd || event.working_directory || event.cwd || process.cwd();

  return { ok: true, eventName, toolName, toolInput, cwd, raw: event };
}

// Standard JSON decision writer used by every hook.
export function emitDecision(decision, reason) {
  const out = { decision };
  if (reason) out.reason = reason;
  process.stdout.write(JSON.stringify(out) + '\n');
}

export function emitError(message) {
  process.stderr.write(`[codex-toolkit] ${message}\n`);
  process.exit(2);
}
