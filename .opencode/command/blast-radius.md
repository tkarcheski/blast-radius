---
description: Limit this session's blast radius — no root, no credentials, nothing outside the project
---

Use the `blast-radius` skill. Follow its rules for every action for the rest of
this session: never escalate privileges, never touch anything outside the
project directory, never read credential files, never weaken the sandbox. If a
command is blocked by the tripwire, stop and report — do not rephrase it to
slip past. If this project is not yet set up with blast-radius, walk through
the skill's setup steps.
