# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-02

### Added
- `diff-budget` hook — refuse writes that exceed a per-task file/byte budget.
  Configurable per-call size, distinct files per task, and total bytes per task.
- `tool-pace-check` hook — slow Codex down when it chains many tool calls in
  a short sliding window. Catches "just one more thing" loops.
- `state-store` module — atomic JSON-file-backed state for hooks that need
  to remember things across invocations.
- `install` / `list` / `doctor` extended to register the new hooks.

### Tests
- 13 new test cases (6 for diff-budget, 5 for tool-pace-check — overlapping
  fixtures cleaned up). Total: **18 cases, all green**.

## [0.1.0] - 2026-06-02

### Added
- First public release.
- `scope-guard` hook — block file edits outside the declared task scope.
- `codex-toolkit init` — one-line installer that wires hooks into `~/.codex/`.
- `codex-toolkit list` — show installed hooks and their status.
- `codex-toolkit doctor` — diagnose common configuration issues.
- README, configuration examples, full unit test suite.
