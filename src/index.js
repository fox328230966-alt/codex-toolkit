// Public entry point. Re-exports the stable API surface.
// All hook modules are also runnable as standalone scripts — see bin/codex-toolkit.js.

export { default as scopeGuard } from './scope-guard.js';
export { install, uninstall, list, doctor } from './installer.js';
export { HOOK_EVENTS, DECISIONS, parseHookInput } from './hook-protocol.js';
