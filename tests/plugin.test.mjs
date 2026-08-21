// Hook-level tests: drive the plugin exactly the way OpenCode does.
// Requires `npm install` (the plugin imports @opencode-ai/plugin).
//
//   npm install && node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import plugin from '../.opencode/plugins/blast-radius.mjs';

// Stub of the OpenCode SDK client the plugin receives; records toasts.
function stubClient() {
  const toasts = [];
  return {
    toasts,
    tui: {
      showToast: async (input) => {
        toasts.push(input?.body ?? {});
        return { data: true };
      },
    },
  };
}

async function init() {
  const client = stubClient();
  const hooks = await plugin({ client, directory: process.cwd() });
  return { client, hooks };
}

test('exports only the default plugin (OpenCode rejects other exports)', async () => {
  const mod = await import('../.opencode/plugins/blast-radius.mjs');
  assert.deepEqual(Object.keys(mod), ['default']);
});

test('tripwire aborts dangerous bash and toasts the block', async () => {
  const { client, hooks } = await init();
  await assert.rejects(
    hooks['tool.execute.before']({ tool: 'bash' }, { args: { command: 'sudo whoami' } }),
    /\[blast-radius\] blocked/,
  );
  assert.equal(client.toasts.length, 1);
  assert.equal(client.toasts[0].variant, 'error');
});

test('tripwire guards file tools against credential paths', async () => {
  const { hooks } = await init();
  await assert.rejects(
    hooks['tool.execute.before']({ tool: 'read' }, { args: { filePath: '/home/u/.ssh/id_rsa' } }),
    /\[blast-radius\] blocked/,
  );
  // normal project file: passes
  await hooks['tool.execute.before']({ tool: 'read' }, { args: { filePath: '/proj/src/a.ts' } });
});

test('config hook injects the permission preset into live config', async () => {
  const { hooks } = await init();
  const config = {};
  await hooks.config(config);
  assert.equal(config.permission.bash['sudo*'], 'deny');
  assert.equal(config.permission.external_directory, 'deny');
});

test('permission.ask force-denies dangerous bash instead of asking', async () => {
  const { hooks } = await init();
  const output = { status: 'ask' };
  await hooks['permission.ask'](
    { type: 'bash', title: 'sudo rm -rf /', pattern: 'sudo*', metadata: { command: 'sudo rm -rf /' } },
    output,
  );
  assert.equal(output.status, 'deny');

  const benign = { status: 'ask' };
  await hooks['permission.ask'](
    { type: 'bash', title: 'git push', pattern: 'git push*', metadata: { command: 'git push' } },
    benign,
  );
  assert.equal(benign.status, 'ask');
});

test('session.created shows a status toast in the TUI', async () => {
  const { client, hooks } = await init();
  await hooks.event({ event: { type: 'session.created', properties: {} } });
  assert.equal(client.toasts.length, 1);
  assert.match(client.toasts[0].message, /armed · \d+ bash tripwires/);
  await hooks.event({ event: { type: 'session.idle', properties: {} } });
  assert.equal(client.toasts.length, 1, 'only session.created toasts');
});

test('blast-radius-status tool reports all three layers', async () => {
  const { hooks } = await init();
  const status = hooks.tool['blast-radius-status'];
  assert.ok(status, 'status tool registered');
  const result = await status.execute({}, {});
  assert.match(result.output, /layer 1 \(policy\)/);
  assert.match(result.output, /layer 2 \(tripwire\)/);
  assert.match(result.output, /layer 3 \(physics\)/);
  assert.equal(typeof result.metadata.container, 'boolean');
});
