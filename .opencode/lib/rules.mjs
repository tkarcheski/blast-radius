// blast-radius — enforcement rules. Pure logic, no OpenCode imports, so unit
// tests can drive it under plain node and the plugin can share it at runtime.

// ---------------------------------------------------------------------------
// Bash tripwires. Each entry: [regex, reason].
// ---------------------------------------------------------------------------
export const DENY_RULES = [
  [/(^|[;&|]\s*)sudo\b/, 'privilege escalation: sudo'],
  [/(^|[;&|]\s*)(su|doas)\s/, 'privilege escalation: su/doas'],
  [/rm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-rf|-fr)\s+["']?(\/|~|\$HOME)/i, 'destructive delete outside the project'],
  [/docker\.sock/, 'docker socket access is root on the host'],
  [/(^|[;&|]\s*)docker\s+(run|exec).*--privileged/, 'privileged container'],
  [/(curl|wget)[^|;&]*\|\s*(ba|z|da)?sh\b/, 'piping the internet into a shell'],
  [/(\/|~\/|\$HOME\/)\.(ssh|aws|gnupg)\//, 'credential directory access'],
  [/chmod\s+(-[a-z]+\s+)?0?777\b/i, 'world-writable permissions'],
  [/(^|[;&|]\s*)(mkfs|fdisk|parted)\b/, 'disk formatting'],
  [/dd\s+[^;&|]*of=\/dev\//, 'raw write to a device'],
  [/>\s*\/dev\/sd[a-z]/, 'raw write to a device'],
  [/(^|[;&|]\s*)shutdown\b|(^|[;&|]\s*)reboot\b/, 'host power control'],
];

export function checkCommand(command) {
  for (const [rule, reason] of DENY_RULES) {
    if (rule.test(command)) return reason;
  }
  return null;
}

// ---------------------------------------------------------------------------
// File-tool guards: the same protection for read/edit/write tool calls, so the
// agent cannot sidestep bash denies by using its file tools directly.
// ---------------------------------------------------------------------------
export const FILE_GUARDS = [
  [/(^|\/)\.ssh(\/|$)/, 'credential directory: .ssh'],
  [/(^|\/)\.aws(\/|$)/, 'credential directory: .aws'],
  [/(^|\/)\.gnupg(\/|$)/, 'credential directory: .gnupg'],
  [/(^|\/)\.config\/gh(\/|$)/, 'gh CLI token store'],
  [/(^|\/)\.(bashrc|zshrc|profile|gitconfig)$/, 'shell/git dotfiles'],
  [/(^|\/)\.env(\.[A-Za-z0-9_-]+)?$/, '.env secrets'],
];

const FILE_TOOLS = new Set(['read', 'edit', 'write', 'patch']);

export function checkFileAccess(toolName, args) {
  if (!FILE_TOOLS.has(toolName)) return null;
  const target = String(args?.filePath ?? args?.path ?? '');
  if (!target) return null;
  for (const [rule, reason] of FILE_GUARDS) {
    if (rule.test(target)) return reason;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Permission preset (layer 1). The plugin injects this into OpenCode's config
// programmatically, so a project is protected even if its opencode.json has no
// permission block at all. Key order matters: catch-alls first, denies last —
// OpenCode resolves permissions last-match-wins.
// ---------------------------------------------------------------------------
export const PERMISSION_PRESET = {
  bash: {
    'sudo*': 'deny',
    'su *': 'deny',
    'su -*': 'deny',
    'doas *': 'deny',
    'rm -rf /*': 'deny',
    'rm -rf ~*': 'deny',
    'rm -rf $HOME*': 'deny',
    'chmod 777 *': 'deny',
    'chmod -R 777 *': 'deny',
    'curl * | sh*': 'deny',
    'curl * | bash*': 'deny',
    'wget * | sh*': 'deny',
    'wget * | bash*': 'deny',
  },
  read: {
    '~/.ssh/*': 'deny',
    '~/.aws/*': 'deny',
    '~/.gnupg/*': 'deny',
    '~/.config/gh/*': 'deny',
    '*.env': 'deny',
    '*.env.*': 'deny',
  },
  edit: {
    '~/.ssh/*': 'deny',
    '~/.aws/*': 'deny',
    '~/.bashrc': 'deny',
    '~/.zshrc': 'deny',
    '~/.profile': 'deny',
    '~/.gitconfig': 'deny',
  },
  external_directory: 'deny',
};

// Merge the preset into a live OpenCode config object (mutates in place).
// Existing user rules are kept; preset rules are appended after them, so under
// last-match-wins the preset denies take precedence for their exact patterns.
export function mergePreset(config) {
  config.permission = config.permission ?? {};
  for (const [key, preset] of Object.entries(PERMISSION_PRESET)) {
    if (typeof preset === 'string') {
      if (config.permission[key] === undefined) config.permission[key] = preset;
      continue;
    }
    const existing = config.permission[key];
    if (existing === undefined || existing === null) {
      config.permission[key] = { ...preset };
    } else if (typeof existing === 'object') {
      for (const [pattern, action] of Object.entries(preset)) {
        existing[pattern] = action;
      }
    }
    // If the user set a plain string (e.g. bash: "allow"), leave it: the
    // tripwire in the plugin still hard-blocks the dangerous commands.
  }
  return config;
}
