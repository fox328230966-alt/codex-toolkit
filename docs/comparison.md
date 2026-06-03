# Comparison: codex-toolkit vs the alternatives

This is a buyer's guide, not marketing copy. If you came here looking for a reason
to *not* use codex-toolkit, this is the file to read.

The four candidates we compare:

- **None** — vanilla Codex CLI with no hooks configured
- **Hand-rolled** — each developer writes a personal hook script per project
- **Built-in** — lean on Codex CLI's existing `approval_policy` / `sandbox_mode` / `rules` features only
- **codex-toolkit** — this project

For each axis below, the answer that *requires the most from the user* (i.e. the
heaviest engineering or the weakest safety story) is the "None" answer. The
"codex-toolkit" column is the lightest-touch option for the same safety level.

## At a glance

|  | None | Hand-rolled | Built-in | codex-toolkit |
| --- | --- | --- | --- | --- |
| Time to set up | 0 min | 1–2 h per project | 15 min | **1 min** |
| Lines of glue code you maintain | 0 | ~200 / project | 0 | **0** |
| Scope-creep defense | ❌ | ⚠️ varies | ❌ | ✅ `scope-guard` |
| Runaway-edit loop detection | ❌ | ⚠️ varies | ❌ | ✅ `tool-pace-check` |
| Per-task byte / file budget | ❌ | ⚠️ varies | ❌ | ✅ `diff-budget` |
| Destructive-command blocklist | ❌ | ⚠️ varies | ⚠️ partial (`rules`) | ✅ `shield-destructive-cmd` |
| Credential / secret-file blocklist | ❌ | ⚠️ varies | ❌ | ✅ `shield-env-guard` |
| Auto-lint on every write | ❌ | ⚠️ varies | ❌ | ✅ `auto-lint` |
| Configurable per project | n/a | ⚠️ (you own the code) | ⚠️ (TOML editing) | ✅ JSON file per hook |
| Per-task mode (enforce / ask / off) | n/a | ⚠️ (you implement) | ❌ (policy is global) | ✅ all six hooks |
| Works across projects without duplication | n/a | ❌ | ✅ | ✅ (`~/.codex/` install) |
| Test suite for the safety net itself | n/a | ❌ | n/a | ✅ **47 cases** |
| Zero runtime dependencies | ✅ | depends on you | ✅ | ✅ |

## What "Built-in" actually buys you

Codex CLI's first-class safety features are real and worth using. They are
**not, however, a substitute for hooks** — they sit at a different layer.

| Built-in | Strength | Gap that codex-toolkit fills |
| --- | --- | --- |
| `approval_policy = "on-request"` | Stops the agent before every non-trivial action | The user drowns in prompts and learns to click "yes" reflexively. The decision boundary is per-action, not per-task. |
| `sandbox_mode = "workspace-write"` | Limits damage to the repo | The repo is *exactly* what the user cares about. Sandbox doesn't distinguish "in scope" from "out of scope". |
| `rules` (forbid / prompt / allow on shell commands) | Catches a few high-profile patterns | A flat list applied globally. No notion of "this pattern is fine for *this* task, forbidden for *that* task". |
| `undo` feature flag (git ghost snapshots) | One-click rollback for the last turn | Reactive. The user finds out about the scope creep *after* it happens. codex-toolkit tries to prevent it in the first place. |

Hooks and built-ins are **complementary**, not competing. The recommended
config in `~/.codex/config.toml` is something like:

```toml
# Built-ins: defensive defaults
approval_policy = "on-request"
sandbox_mode   = "workspace-write"
features.undo  = true

# Then codex-toolkit layered on top, per project
```

## When *not* to use codex-toolkit

- You're an Anthropic / Claude Code shop and won't touch Codex CLI. Claude
  Code's hooks cover similar ground, and there's no point maintaining two
  parallel safety nets.
- You genuinely want the agent to have free rein (e.g. a sandboxed CI job
  that's already locked down by OCI / network policy). The hooks would
  just add noise.
- You're on a one-off experiment, not a real project. The ten minutes
  saved by skipping hooks are not worth the ten minutes lost when the
  agent rewrites a file you didn't ask for.

## When you absolutely *should* use it

- You use Codex CLI for actual work and have been bitten by out-of-scope
  edits at least once.
- You maintain a serious project where a 200-line unreviewed churn is
  genuinely bad — open source library, customer-facing service, etc.
- You let the agent run for many turns in a row (i.e. the loop has time
  to drift).
- You pair-code with the agent and want it to *stop* at a clean
  checkpoint, not at "I also reformatted 14 unrelated files".
