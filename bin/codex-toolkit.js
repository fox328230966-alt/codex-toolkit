#!/usr/bin/env node
// codex-toolkit — main CLI shim. Forwards to src/installer.js#main.
// This file is the `bin` entry; the real implementation lives in src/ so
// it can be unit-tested without spawning a subprocess.
//
// We can't rely on a top-level "am I the entry point?" check inside
// src/installer.js: when this bin is invoked through `npx codex-toolkit …`,
// `process.argv[1]` points at the npx launcher, not at this file, so a
// argv-based check would (and did) silently skip the main() call. Instead
// we explicitly invoke the entry function from here.

(async () => {
  const mod = await import('../src/installer.js');
  mod.main();
})().catch((err) => {
  process.stderr.write(`[codex-toolkit] fatal: ${err.stack || err.message}\n`);
  process.exit(1);
});
