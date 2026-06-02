#!/usr/bin/env node
// codex-toolkit — main CLI shim. Forwards to src/installer.js#main.
// This file is the `bin` entry; the real implementation lives in src/ so
// it can be unit-tested without spawning a subprocess.

import('../src/installer.js');
