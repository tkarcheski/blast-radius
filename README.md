<p align="center">
  <strong>blast-radius</strong>
</p>
<p align="center">
  <strong>Protect ourselves from ourselves. The agent gets the project directory — and nothing else.</strong>
</p>
<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/tkarcheski/blast-radius?style=flat" alt="License"></a>
</p>

## The problem

An agent will eventually run a command that hurts you. Not out of malice — out of confidence. `sudo` because a package install failed. `rm -rf` one directory too high. `cat ~/.ssh/id_ed25519` because it seemed relevant. And `--auto` mode, the whole point of agents, approves all of it.

## The fix: three layers

Not a prompt skill — real logic wired into [OpenCode](https://opencode.ai)'s plugin API. Each layer catches what the one above it misses.

| Layer | Where | What it is | Stops |
| --- | --- | --- | --- |
| 1. Policy | [`opencode.json`](./opencode.json) + injected by the plugin | Permission deny rules on `bash`, `read`, `edit` | The agent quietly doing risky things |
| 2. Tripwire | [`.opencode/plugins/blast-radius.mjs`](./.opencode/plugins/blast-radius.mjs) | Hooks that abort dangerous tool calls before they run | Foot-guns even in `--auto`, where "ask" never asks |
| 3. Physics | [`docker/`](./docker/) | OpenCode in a non-root container; project dir is the only mount | Everything else. No root, no `~/.ssh`, no docker socket |

Layers 1 and 2 are rules. Layer 3 is reality: even if both fail, there is no root to escalate to and no host filesystem to damage.

## How the plugin integrates with OpenCode

Five real integration points, not system-prompt text:

| Hook | What it does |
| --- | --- |
| `config` | Injects the layer-1 permission preset into the live config — a project with no permission block in `opencode.json` is still protected |
| `tool.execute.before` | The tripwire: aborts dangerous bash (12 rule classes) and file-tool access to credential paths (`~/.ssh`, `.env`, dotfiles) before execution |
| `permission.ask` | The floor: dangerous bash that reaches the permission system is force-denied, never "ask"ed |
| `event` (`session.created`) | Status toast in the TUI the moment a session starts: tripwires armed, container detected or not |
| `tool` (`blast-radius-status`) | A live status tool — ask "what's the sandbox status?" and the agent reports all three layers in the UI |

The skill itself is at [`.opencode/skills/blast-radius/SKILL.md`](./.opencode/skills/blast-radius/SKILL.md) (OpenCode's native discovery path) and carries the behavioral rules; the plugin carries the ones the model doesn't get a vote on.

## Status in the UI

- **On session start** — toast: `armed · 12 bash tripwires · 6 file guards · layer 3: container ✔` (green in the container, yellow warning on the host).
- **On a block** — error toast with the reason, and the tool call aborts with `[blast-radius] blocked (…)`.
- **On demand** — `/blast-radius` loads the skill; asking for sandbox status runs the `blast-radius-status` tool.

## Install

```bash
git clone https://github.com/tkarcheski/blast-radius
cd blast-radius
```

Run `opencode` in the repo: the skill, command, plugin, and permission preset all register. For your own project, copy `opencode.json`, `.opencode/`, and `docker/` in.

For unattended runs, don't run OpenCode on the host at all:

```bash
./docker/blast-radius.sh --auto                  # non-root container, project dir only
BLAST_RADIUS_NET=none ./docker/blast-radius.sh   # full lockdown: no network either
```

## Prove it

```bash
npm install
npm test
```

Three tiers, 21 tests:

1. **Unit** ([`tests/rules.test.mjs`](./tests/rules.test.mjs)) — every tripwire and file guard, plus the allowed list (`rm -rf node_modules` must sail through).
2. **Hook-level** ([`tests/plugin.test.mjs`](./tests/plugin.test.mjs)) — drives the plugin exactly as OpenCode does: tripwire aborts + toasts, `permission.ask` force-denies, config injection, status tool output.
3. **Full integration** ([`tests/test_opencode_integration.py`](./tests/test_opencode_integration.py)) — boots a real `opencode serve` and asserts via its HTTP API: plugin loads cleanly, `blast-radius` appears in `/skill`, the command in `/command`, the status tool in `/experimental/tool/ids`, the deny rules live on the build agent, and — with the permission block stripped from `opencode.json` entirely — the plugin still injects the preset.

Or ask the agent to run `sudo whoami`:

```
[blast-radius] blocked (privilege escalation: sudo). This tripwire exists to
protect us from ourselves.
```

## Threat model

| Threat | Layer that stops it |
| --- | --- |
| Host file damage (`rm -rf`, dotfile edits) | 1 denies patterns, 2 blocks bash and file tools, 3 makes the host unreachable |
| Credential theft (`~/.ssh`, `~/.aws`, `.env`) | 1 denies reads, 2 guards both bash and file tools, 3 never mounts them |
| Privilege escalation (`sudo`, docker socket) | 2 blocks both; 3 has no sudo installed and no socket mounted |
| Unattended `--auto` runs | 2 throws and force-denies without asking; 3 doesn't ask anything |

Known limits, on purpose: layer 2 is pattern matching, and pattern matching can be routed around by a sufficiently creative command. That's why layer 3 exists. If you only adopt one layer, adopt 3.

## Tune it

Fork it. All enforcement logic lives in [`.opencode/lib/rules.mjs`](./.opencode/lib/rules.mjs) — one file of regexes and the permission preset, imported by both the plugin and the tests. The agent's behavioral rules live in [`SKILL.md`](./.opencode/skills/blast-radius/SKILL.md).

## License

MIT.
