// blast-radius — OpenCode plugin. Real enforcement, not prompt vibes.
//
// Five integration points with OpenCode:
//
//   config                — injects the layer-1 permission preset into the live
//                           config, so even a project with no permission block
//                           in opencode.json gets the deny rules.
//   tool.execute.before   — the tripwire: aborts dangerous bash commands and
//                           file-tool access to credential paths before they
//                           execute. Holds even under `--auto`.
//   permission.ask        — the floor: if a dangerous command still reaches the
//                           permission system, force-deny it instead of asking.
//   event(session.created)— shows a status toast in the TUI: tripwires armed,
//                           container (layer 3) detected or not.
//   tool                  — a `blast-radius-status` tool the agent (and you)
//                           can call to see live sandbox status in the UI.
//
// The skill in `.opencode/skills/blast-radius/SKILL.md` carries the behavioral
// rules; this file carries the ones the model doesn't get a vote on.
//
// NOTE: OpenCode treats every export of a plugin module as a plugin function,
// so this file exports ONLY the default plugin. Shared logic lives in
// ../lib/rules.mjs.

import fs from 'fs';
import { tool } from '@opencode-ai/plugin';
import {
  DENY_RULES,
  FILE_GUARDS,
  checkCommand,
  checkFileAccess,
  mergePreset,
} from '../lib/rules.mjs';

function inContainer() {
  if (process.env.BLAST_RADIUS_CONTAINER === '1') return true;
  try {
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

function statusLine() {
  const layer3 = inContainer()
    ? 'layer 3: container ✔'
    : 'layer 3: HOST — run ./docker/blast-radius.sh for real isolation';
  return `armed · ${DENY_RULES.length} bash tripwires · ${FILE_GUARDS.length} file guards · ${layer3}`;
}

export default async ({ client }) => {
  return {
    // Layer 1, programmatically: the preset goes into the live config.
    config: async (config) => {
      mergePreset(config);
    },

    // Layer 2: the tripwire. Throwing aborts the tool call before it runs.
    'tool.execute.before': async (input, output) => {
      const reason =
        input.tool === 'bash'
          ? checkCommand(String(output?.args?.command ?? ''))
          : checkFileAccess(input.tool, output?.args);
      if (!reason) return;
      try {
        await client.tui.showToast({
          body: { title: 'blast-radius', message: `blocked — ${reason}`, variant: 'error' },
        });
      } catch {
        // headless server: no TUI attached, nothing to toast
      }
      throw new Error(
        `[blast-radius] blocked (${reason}). ` +
          'This tripwire exists to protect us from ourselves. If this action is ' +
          'genuinely needed, a human runs it by hand, outside the agent.',
      );
    },

    // The floor under the permission system: dangerous bash never gets to
    // "ask" — it is denied outright, even if someone loosened the config.
    'permission.ask': async (input, output) => {
      if (input.type !== 'bash') return;
      const patterns = Array.isArray(input.pattern) ? input.pattern : [input.pattern ?? ''];
      const candidates = [input.title ?? '', String(input.metadata?.command ?? ''), ...patterns];
      if (candidates.some((c) => c && checkCommand(String(c)))) {
        output.status = 'deny';
      }
    },

    // Visible status in the UI the moment a session starts.
    event: async ({ event }) => {
      if (event.type !== 'session.created') return;
      try {
        await client.tui.showToast({
          body: {
            title: 'blast-radius',
            message: statusLine(),
            variant: inContainer() ? 'success' : 'warning',
            duration: 6000,
          },
        });
      } catch {
        // headless server: no TUI attached
      }
    },

    // Live status on demand: the agent calls this; the result renders in the UI.
    tool: {
      'blast-radius-status': tool({
        description:
          'Report the live status of the blast-radius sandbox: armed bash tripwires, file guards, permission preset, and whether layer 3 (Docker container isolation) is active. Use when asked about sandbox/guardrail status.',
        args: {},
        execute: async () => {
          const lines = [
            `blast-radius: ${statusLine()}`,
            '',
            `layer 1 (policy): permission preset injected into live config`,
            `layer 2 (tripwire): ${DENY_RULES.length} bash rules + ${FILE_GUARDS.length} file guards, enforced in tool.execute.before and permission.ask`,
            `layer 3 (physics): ${
              inContainer()
                ? 'active — running inside the blast-radius container'
                : 'NOT active — running on the host. Start via ./docker/blast-radius.sh'
            }`,
          ];
          return {
            title: 'blast-radius status',
            output: lines.join('\n'),
            metadata: {
              tripwires: DENY_RULES.length,
              fileGuards: FILE_GUARDS.length,
              container: inContainer(),
            },
          };
        },
      }),
    },
  };
};
