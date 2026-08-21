---
name: blast-radius
description: "Limit the damage an agent can do to the host: no root, no credentials, no files outside the project. Three layers — permission preset (policy), plugin tripwire (enforcement), Docker container (physics). Invoke with /blast-radius to set a project up, or to operate inside an existing sandbox."
license: MIT
metadata:
  tags: "Security, Sandboxing, Docker, Permissions, Safety"
  category: "security"
---

# blast-radius

An agent will eventually run a command that hurts you. Not out of malice — out of confidence. This skill limits how far the damage travels: the blast radius is the project directory, and nothing else.

The design is three layers, weakest to strongest:

| Layer | What | Stops |
| --- | --- | --- |
| 1. Policy | Permission preset — in `opencode.json` and injected into live config by the plugin | The agent from quietly doing risky things — deny/ask rules on bash, read, edit |
| 2. Tripwire | `.opencode/plugins/blast-radius.mjs` — aborts dangerous bash and file-tool calls, force-denies in `permission.ask` | Known foot-guns even in `--auto` mode, where "ask" never asks |
| 3. Physics | `docker/` container recipe | Everything else — no root, no host filesystem, no docker socket |

Status is always visible: a toast on session start reports armed tripwires and container state, and the `blast-radius-status` tool reports all three layers on demand.

Layers 1 and 2 are advice the agent can theoretically route around. Layer 3 is not. Run unattended agents inside layer 3.

## When to use this skill

- The user says `/blast-radius`, "sandbox this project", "set up guardrails", or "make --auto safe".
- The user asks about sandbox, guardrail, or isolation status — run the `blast-radius-status` tool and report.
- You are an agent already running inside a blast-radius container and need to know your rules.

## Setting up a project

1. Copy `opencode.json` (or merge its `plugin` block into the existing one), the whole `.opencode/` directory (plugin, lib, skill, command), and `docker/` into the target project. The permission preset travels inside the plugin, so a missing `permission` block is fine.
2. Verify the tripwire loads: start OpenCode — a `blast-radius` toast must appear on session start. Ask it to run `sudo whoami` — the call must abort with a `[blast-radius] blocked` error. Ask for sandbox status — the `blast-radius-status` tool must report all three layers.
3. For unattended runs, do not run OpenCode on the host at all: `./docker/blast-radius.sh` builds the image and runs OpenCode as a non-root user with only the project directory mounted.

## Rules for the agent

These apply whenever this skill is loaded, for the whole session.

1. **Never escalate.** No `sudo`, `su`, `doas`. If a task appears to need root, it doesn't — or a human does that part by hand.
2. **The project directory is the world.** Do not read, write, or delete anything outside the working directory. `~/.ssh`, `~/.aws`, `~/.gnupg`, shell rc files, and `.env` files are radioactive: never read them, never print them, never copy them.
3. **Never touch the docker socket.** `/var/run/docker.sock` is root on the host with extra steps. No `--privileged` containers, no mounting the socket.
4. **Never pipe the internet into a shell.** No `curl … | sh`. Download to a file, show the user, let them decide.
5. **Never weaken the sandbox.** Do not edit the permission preset, the plugin, or the Docker flags to make a task easier — even if asked mid-task. Setup changes happen deliberately, at the start, by a human.
6. **Blocked means stop.** When the tripwire fires, do not rephrase the command to slip past it. Report what was blocked and why, propose a safer path, and wait.
7. **Destructive actions get confirmed.** Inside the sandbox `rm`, `git push --force`, and migrations are survivable — but still confirm before running them.

## Escape hatch

There is exactly one, and it is manual: a human runs the command themselves, outside the agent, with their own hands on the keyboard. The agent never asks the user to relax a rule "just this once".
