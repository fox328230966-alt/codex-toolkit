# codex-toolkit

> **Stop AI scope creep in Codex CLI.**
> A toolkit of practical hooks that keep your AI edits scoped, budgeted, and safe.
>
> A hook-based safety layer for Codex CLI that blocks scope creep,
> unsafe commands, sensitive-file writes, and oversized edits before they
> turn into review noise.

[![CI](https://github.com/fox328230966-alt/codex-toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/fox328230966-alt/codex-toolkit/actions)
[![npm version](https://img.shields.io/npm/v/codex-toolkit.svg)](https://www.npmjs.com/package/codex-toolkit)
[![npm downloads](https://img.shields.io/npm/dw/codex-toolkit.svg)](https://www.npmjs.com/package/codex-toolkit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-blue.svg)](package.json)

---

## The problem

You ask Codex CLI to fix a bug in `auth.ts`. It comes back having
reformatted 14 unrelated files, rewritten your `README`, and bumped a
dependency. The result is technically fine — but it is **not what you
asked for**, and now you have 200 lines of unreviewed churn in your diff.

This is **scope creep**, and it is the unsolved ergonomic problem of
AI coding tools in 2026.

## The fix

`codex-toolkit` is a small set of **hooks** (lifecycle scripts) you
install into Codex CLI. Each hook has one job:

| Hook | Job |
| --- | --- |
| `scope-guard` | Block file edits outside the scope you declared for this task. |
| `diff-budget` | Refuse edits once a per-task file/line budget is exceeded. |
| `tool-pace-check` | Slow the agent down when it tries to chain many tool calls in a row. |
| `shield-destructive-cmd` | Refuse `rm -rf`, `git push --force`, `drop table`, etc. |
| `shield-env-guard` | Refuse writes to `.env`, `id_rsa`, `*.key`, and similar. |
| `auto-lint` | Run the right linter after a Go / Python / TS file is touched. |

> The v0.4.0 release ships the full six-hook suite:
> **`scope-guard`**, **`diff-budget`**, **`tool-pace-check`**,
> **`shield-destructive-cmd`**, **`shield-env-guard`**, and **`auto-lint`**.

![codex-toolkit in action: shield-env-guard refuses a .env write, scope-guard allows the in-scope .ts edit, auto-lint confirms clean](docs/demo.svg)

## See it run

The demo below calls the real hook modules with sample Codex tool events.
It does not require installing Codex CLI or touching your `~/.codex` config.

```sh
npm run demo
```

Example output:

```text
codex-toolkit demo: real hook decisions
scope: allow src/auth/** and tests/auth/** only

DENY  shield-env-guard write_file(.env) — shield-env-guard: refused to write to ".env" — matches a sensitive path (SSH key, .env, cloud cred, package-manager token, or secrets dir). If this is intentional, set "allow_overrides" in .codex-toolkit/shield-env-guard.json.
DENY  scope-guard write_file(README.md) — scope-guard: "README.md" is outside the declared scope ["src/auth/**","tests/auth/**"]. Update your .codex-toolkit/scope-guard.json if this edit is intentional.
ALLOW scope-guard write_file(src/auth/login.ts)
DENY  shield-destructive-cmd shell("git reset --hard") — shield-destructive-cmd: refused command git reset --hard Matched destructive pattern(s): - git-hard-reset: hard reset discards uncommitted changes If this is intentional, set "allow_overrides" in .codex-toolkit/shield-destructive-cmd.json.
DENY  diff-budget write_file(src/auth/large.ts) — diff-budget: per-write size (120) exceeded limit (80). Increase the limit in .codex-toolkit/diff-budget.json or split the task.
```

## Why this category, why now

Codex CLI shipped lifecycle hooks as a stable, default-on feature in
2025. For the first time, a small piece of user code can sit in the
critical path of every tool call without forking the agent. Until now,
guardrails were either:

- **coarse** (workspace-wide sandbox), or
- **manual** (the user has to read every approval prompt and click no).

`codex-toolkit` is the **per-task guardrail layer** that fits between
those two — see [`docs/why-scope-creep.md`](docs/why-scope-creep.md)
for the longer version.

## Architecture

Six hooks. Two trigger points. Zero runtime dependencies.

![codex-toolkit architecture — six hooks placed at PreToolUse and PostToolUse of the Codex CLI lifecycle](docs/architecture.svg)

| Trigger | Hooks | What they decide |
| --- | --- | --- |
| **PreToolUse** (before the tool runs) | `scope-guard`, `tool-pace-check`, `shield-destructive-cmd`, `shield-env-guard` | "Should this tool call even happen?" |
| **PostToolUse** (after the tool runs) | `diff-budget`, `auto-lint` | "Was the result acceptable?" |

Both points emit a JSON decision `{ "decision": "allow" | "ask" | "deny", "reason": "..." }` and respect the hook process's exit code (`0` = success, `2` = blocking error → deny). See [`docs/architecture.svg`](docs/architecture.svg) for the full diagram.

## Compatibility

`codex-toolkit` targets Codex CLI lifecycle hooks that pass JSON events to
hook subprocesses on stdin and accept JSON decisions on stdout:

```json
{ "decision": "allow" | "ask" | "deny", "reason": "..." }
```

The parser intentionally accepts several observed event shapes:
`event` / `hook_event_name` / `eventName`, `tool_name` / `toolName`, and
`tool_input` / `toolInput`. The current test suite covers the file-writing
and shell-command shapes used by the bundled hooks. If Codex publishes a
formal hook schema, the compatibility surface is isolated in
[`src/hook-protocol.js`](src/hook-protocol.js).

## Install

```sh
# 1. Pull the package (no global install needed):
npx codex-toolkit@latest init
```

That one command copies every bundled hook into `~/.codex/hooks/`, writes `~/.codex/hooks.json` registering them with Codex CLI, and appends a `[hooks]` section to `~/.codex/config.toml` (only if you don't already have one).

Verify:

```sh
npx codex-toolkit@latest list     # see what is installed
npx codex-toolkit@latest doctor   # run sanity checks + smoke test
```

If you'd rather install from source (e.g. to hack on a hook), clone the repo and run the same `init` command directly:

```sh
git clone https://github.com/fox328230966-alt/codex-toolkit.git
cd codex-toolkit
node bin/codex-toolkit.js init
```

`init` will:

1. Copy every bundled hook into `~/.codex/hooks/`.
2. Write `~/.codex/hooks.json` registering them with Codex CLI.
3. Append a `[hooks]` section to `~/.codex/config.toml` (only if you
   don't already have one).

Verify:

```sh
node bin/codex-toolkit.js list     # see what is installed
node bin/codex-toolkit.js doctor   # run sanity checks + smoke test
```

## Configure `scope-guard`

Drop a JSON config at one of:

- `<your-project>/.codex-toolkit/scope-guard.json` (project-level)
- `~/.codex/scope-guard.json` (user-level, applies to all projects)
- `$CODEX_TOOLKIT_SCOPE_GUARD_CONFIG` (explicit override)

```json
{
  "mode": "enforce",
  "allow": ["src/auth/**", "src/shared/**", "tests/auth/**"],
  "deny":  [".env", ".env.*", "**/secrets/**", "**/migrations/**"],
  "log": true
}
```

| Field | Values | Effect |
| --- | --- | --- |
| `mode` | `enforce` \| `ask` \| `off` | `enforce` = hard-deny out-of-scope edits. `ask` = prompt the user. `off` = no-op. |
| `allow` | glob list | Paths matching at least one pattern are allowed. |
| `deny`  | glob list | If a path matches *any* deny pattern, the edit is refused — even if it would have been allowed. |
| `log`   | bool | When `true`, every decision is logged to stderr. |

Glob syntax: `*` matches a single path segment, `**` matches any number of segments (including zero), `?` matches a single character, `.` is a literal dot.

### Example: prompt the model to declare its scope

The best way to use `scope-guard` is to put a scope declaration at the top of your prompt:

> _"Refactor the OAuth flow. The only files you may touch are `src/auth/**` and `tests/auth/**`. Anything else: ask first."_

…and put a matching `allow` list in the config. Codex's edit planning is good enough that this combination cuts 90% of out-of-scope churn.

## Configure `shield-destructive-cmd` and `shield-env-guard`

These hooks have a default deny list baked in. To override, drop a JSON file at:

- `<your-project>/.codex-toolkit/shield-destructive-cmd.json`
- `<your-project>/.codex-toolkit/shield-env-guard.json`

(or the `~/.codex/` equivalents).

```json
// .codex-toolkit/shield-destructive-cmd.json
{
  "mode": "enforce",
  "extra_patterns": ["\\bterraform\\s+destroy\\b"],
  "allow_overrides": ["^git\\s+push\\s+--force\\s+to-my-personal-fork"]
}
```

```json
// .codex-toolkit/shield-env-guard.json
{
  "mode": "enforce",
  "extra_patterns": ["**/internal-token*"],
  "allow_overrides": ["docs/.env.example"]
}
```

`extra_patterns` is appended to the built-in deny list; `allow_overrides` is consulted first and short-circuits the deny list if any entry matches.

## Configure `diff-budget` and `tool-pace-check`

These hooks have a default config baked in. To override, drop a JSON file at:

- `<your-project>/.codex-toolkit/diff-budget.json`
- `<your-project>/.codex-toolkit/tool-pace.json`

(or the `~/.codex/` equivalents).

```json
// .codex-toolkit/diff-budget.json
{
  "mode": "enforce",
  "max_bytes_per_write": 100000,
  "max_files_per_task": 25,
  "max_total_bytes": 500000
}
```

```json
// .codex-toolkit/tool-pace.json
{
  "mode": "enforce",
  "max_calls_in_window": 8,
  "window_seconds": 60
}
```

State files (per-session counters) live at `<cwd>/.codex-toolkit/.diff-budget.json` and `.tool-pace.json`. Delete them to reset a task's budget.

## Configure `auto-lint`

Default config: every recognized extension gets a sane linter. Override at `<your-project>/.codex-toolkit/auto-lint.json` (or `~/.codex/auto-lint.json`):

```json
{
  "mode": "enforce",
  "fallback": "allow",
  "linters": {
    "go": { "cmd": ["gofmt", "-l"], "timeout_ms": 5000 },
    "py": { "cmd": ["ruff", "check", "--stdin-display-path", "PLACEHOLDER", "-"], "timeout_ms": 10000 },
    "ts": { "cmd": ["eslint", "--no-warn-ignored", "--stdin", "--stdin-filename", "PLACEHOLDER"], "timeout_ms": 15000 }
  }
}
```

`fallback: "deny"` is the strict choice — refuse any change that the linter can't actually check (e.g. the linter binary is missing on PATH). The default `"allow"` is the friendly choice: log a warning, let the change through, trust the user to lint later.

## Recipes

### Only let Codex touch one feature area

```json
{
  "mode": "enforce",
  "allow": ["src/auth/**", "tests/auth/**"],
  "deny": [".env", ".env.*", "**/secrets/**"]
}
```

Use this when a prompt says "fix auth" and you do not want opportunistic
README, dependency, or unrelated module edits.

### Protect migrations and generated files

```json
{
  "mode": "ask",
  "allow": ["src/**", "tests/**"],
  "deny": ["**/migrations/**", "**/*.generated.*", "package-lock.json"]
}
```

`ask` mode keeps the guardrail visible without hard-blocking legitimate
maintenance work.

### Loosen budgets for a planned refactor

```json
{
  "mode": "enforce",
  "max_bytes_per_write": 250000,
  "max_files_per_task": 60,
  "max_total_bytes": 1000000
}
```

Use a larger budget when the task is intentionally broad, then delete
`.codex-toolkit/.diff-budget.json` to reset the counters for the next task.

## Compare with alternatives

We wrote down the four-way comparison (vanilla Codex, hand-rolled hooks, Codex built-ins only, `codex-toolkit`) in [`docs/comparison.md`](docs/comparison.md). The short version:

- **Vanilla Codex** has no scope / pace / budget / blocklist / auto-lint defenses.
- **Hand-rolled hooks** work but you maintain ~200 LOC of glue per project and never get a test suite for the safety net itself.
- **Built-ins** (`approval_policy`, `sandbox_mode`, `rules`, `undo`) are real and worth using, but they are *complementary*, not a substitute. Sandbox doesn't know "in scope". `undo` is reactive.
- **`codex-toolkit`** is the lightest-touch option for the same safety level: `codex-toolkit init`, edit a 5-line JSON if you want to customize, done.

The recommended config in `~/.codex/config.toml` is to **layer** the two: built-ins as defensive defaults, codex-toolkit hooks as the per-task guardrail on top.

## Run as a library

`codex-toolkit` is also a small ESM library:

```js
import { evaluate, DECISIONS } from 'codex-toolkit/hooks/scope-guard';

const event = {
  eventName: 'PreToolUse',
  toolName: 'write_file',
  toolInput: { file_path: 'src/auth/login.ts' },
  cwd: process.cwd(),
  raw: {},
};

const result = evaluate(event);
if (result.decision === DECISIONS.DENY) {
  console.error('Refused:', result.reason);
}
```

## Development

```sh
npm install
npm test
npm run lint
```

Hooks ship with a full unit test suite (Node's built-in `node:test` —
no extra deps). CI runs the suite on Node 18, 20, and 22.

## Roadmap

- [x] `scope-guard` — v0.1.0
- [x] `diff-budget` — v0.2.0
- [x] `tool-pace-check` — v0.2.0
- [x] `shield-destructive-cmd` — v0.3.0
- [x] `shield-env-guard` — v0.3.0
- [x] `auto-lint` — v0.4.0
- [x] `npx codex-toolkit init` published to npm — v0.4.0
- [ ] Per-hook "explain why" debug output — v0.5.0
- [ ] Codex IDE extension parity — v0.6.0

## Contributing

Issues and PRs welcome. The bar is intentionally low:

- One hook or one behavior per PR.
- Tests for the behavior you changed.
- A line in the `README.md` hook table.
- Run `npm test` and `npm run lint` before pushing.

See [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md).

## License

MIT — see [LICENSE](LICENSE).
