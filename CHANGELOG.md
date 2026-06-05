# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.3] - 2026-06-05

### Added
- `npm run demo` now runs real hook decisions against sample Codex tool events.
- README now includes a runnable demo, compatibility notes, and task-scope recipes.
- GitHub Actions CI now runs the test and lint suite on Node 18, 20, and 22.

### Changed
- npm package contents now include `docs/` and `scripts/` so README assets and
  the demo script are present in the published tarball.
- `npm run lint` now checks `scripts/*.js` in addition to `src/*.js` and `bin/*.js`.

### Fixed
- Installer now groups multiple hook commands under one TOML event key instead
  of writing duplicate `PreToolUse` / `PostToolUse` keys.
- Installed hooks now get a local `package.json` with `"type": "module"` so
  copied ESM hook files run correctly on Node 18.
- `auto-lint` tests now use ESM-compatible binary detection instead of silently
  skipping real-linter checks.
- GitHub Actions no longer enables npm cache without a lockfile.

## [0.4.2] - 2026-06-03

### Fixed
- Installer now copies shared hook support modules into `~/.codex/hooks/`, so
  installed hooks can resolve their relative imports.
- `scope-guard` now denies common sensitive paths out of the box, including
  `.env`, `.env.*`, `secrets/`, and `.git/`.

## [0.4.1] - 2026-06-03

### Fixed
- CLI bin shim now explicitly invokes the installer entry point when run
  through `npx codex-toolkit`.

## [0.4.0] - 2026-06-03

### Added
- `auto-lint` hook — runs the right linter on every file Codex writes. Detects
  language by extension: `.go` → `gofmt`, `.py`/`.pyi` → `ruff check`,
  `.ts`/`.tsx`/`.js`/`.jsx` → `eslint --stdin`, `.rs` → `rustfmt --check`.
  PostToolUse decision: deny if the linter reports issues, ask on timeout,
  allow on clean / missing linter (configurable).
- Per-linter `cmd` and `timeout_ms` are user-overridable in
  `.codex-toolkit/auto-lint.json`; `fallback` controls behavior when the
  linter binary is not on PATH (`allow` or `deny`).
- 9 new test cases (8 logic + 1 real-linter smoke test against `gofmt`).
  Total: **47 green, 0 red**.
- `docs/demo.svg` — embeddable terminal demo showing the
  `shield-env-guard` hook intercepting a `.env` write. No external
  recording tool needed.

## [0.3.0] - 2026-06-02

### Added
- `shield-destructive-cmd` hook — refuse shell commands that can destroy the
  project. Default deny list covers `rm -rf /`, `rm -rf ~`, `rm -rf *`,
  `git push --force`, `git reset --hard`, `git clean -fd`, `drop database/table`,
  `truncate`, `kubectl delete` without `--dry-run`, `docker system prune -a`,
  the classic fork bomb, `dd of=/dev/sd*`, and `chmod -R 777 /`. Users can
  append patterns via `extra_patterns` and grant per-command `allow_overrides`.
- `shield-env-guard` hook — refuse writes to credential and secret files:
  `.env*`, SSH keys (`id_rsa`, `id_ed25519`, etc.), PEM/key/p12/pfx files,
  AWS/GCP credential files, package-manager token files (`.npmrc`, `.pypirc`,
  `.netrc`), and `secrets/` / `credentials/` / `.gnupg/` directories.
- Both hooks support `mode: enforce | ask | off`, `extra_patterns`, and
  `allow_overrides`.
- 20 new test cases (10 for each hook). Total: **37 green, 0 red**.

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
