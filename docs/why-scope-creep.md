# Why "scope creep" is the unsolved problem of AI coding

The AI coding tool category has matured faster than its safety story. As of
2026, every major terminal agent (Codex CLI, Claude Code, Gemini CLI,
Aider, etc.) can do roughly the same set of things:

- read a project
- run shell commands
- edit or create files
- search the web

What it **cannot** do reliably is **stay in scope**.

## The shape of the problem

You say:

> "Fix the off-by-one in `auth.ts`."

A reasonable human reads this as: open `auth.ts`, find the bug, fix it,
done.

A reasonable AI reads this as:

> "Optimize the auth module — and while you're at it, the rest of
> `src/api/` looks similar, let me reformat it. Also the README references
> these functions and is out of date, let me fix that. The tests have a
> couple of flaky cases unrelated to the bug, let me stabilize them. The
> `package.json` is using an old version of a dep, let me bump it…"

That second interpretation is not malicious. It is what happens when an
agent is optimizing for "helpfulness" without a concrete definition of
"task boundary." A few years from now we'll probably solve this at the
model level. Today, we need a **mechanical** answer.

## What mechanical answers exist today?

- **Approval policies.** Codex CLI's `approval_policy = "on-request"` makes
  the agent ask before every non-trivial action. This helps, but it
  *drowns the user in prompts* and quickly trains them to click "yes" on
  everything.
- **Sandboxing.** `sandbox_mode = "workspace-write"` constrains damage to
  the workspace. This is necessary but not sufficient — the workspace is
  still the user's project.
- **Per-tool rules.** Codex CLI's `rules` allow path- and command-level
  allow/deny lists. Powerful, but the user has to write them by hand
  and they apply globally, not per-task.
- **Git snapshots.** The `undo` feature flag (now stable) gives the user
  an "undo this turn" button. This is a great safety net — but it is
  still reactive: you find out about the scope creep *after* it happens.

## What we're missing

A **task-scoped guardrail** — a mechanism that says, in effect:

> "For the duration of *this* task, only edits in *these* paths are
> allowed. Anything else: ask, or refuse."

That is the gap `codex-toolkit` fills. `scope-guard` is a hook that
reads a small JSON config the user drops in the project, and turns
"unauthorized edits" into hard denies (or approval prompts, depending
on mode).

## Why hooks, why now

Codex CLI shipped lifecycle hooks as a stable, default-on feature in
2025. For the first time, a small piece of user code can sit in the
critical path of every tool call without becoming a fork of the agent.
That makes the category of "guardrail-as-a-hook" viable for the first
time.

`codex-toolkit` is what we want this category to look like:

- A handful of focused, single-purpose hooks.
- A config file that is 5 lines, not 50.
- A test suite and a smoke test for every hook.
- Zero runtime dependencies (Node 18+ is the only requirement).

If you have ever closed a Codex session wondering *why it rewrote 12
files when you only asked for one*, this toolkit is for you.
