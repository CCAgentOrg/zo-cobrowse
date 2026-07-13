// Bang (!) commands — pure logic, no chrome.* or DOM dependencies.
// Imported by sidepanel.js (ESM) and directly by tests.

export const BANG_COMMANDS = {
  summarize: {
    preset: 'summarize',
    label: 'Summarize',
    desc: 'Condense the page into a concise summary',
    buildQuery: () => 'Summarize this page concisely.',
  },
  extract: {
    preset: 'scrape',
    label: 'Extract',
    desc: 'Extract structured data (tables, lists, contacts, prices)',
    buildQuery: (args) => args ? `Extract ${args} from this page as structured data.` : 'Extract all structured data from this page.',
  },
  research: {
    preset: 'research',
    label: 'Research',
    desc: 'Deep research on the page topic',
    buildQuery: (args) => args ? `Do deep research on: ${args}` : 'Do deep research on this page topic.',
  },
  qa: {
    preset: 'qa',
    label: 'Q&A',
    desc: 'Answer a specific question about the page',
    buildQuery: (args) => args || 'What is this page about?',
  },
  ask: {
    preset: 'qa',
    label: 'Ask',
    desc: 'Alias for !qa',
    buildQuery: (args) => args || 'What is this page about?',
  },
  fill: {
    preset: null,
    label: 'Fill',
    desc: 'Ask Zo to fill editable fields on the page',
    buildQuery: (args) => args ? `Fill the form on this page: ${args}` : 'Fill the editable form fields on this page with reasonable test data.',
  },
  skills: {
    preset: null,
    label: 'Skills',
    desc: 'List available Zo skills',
    buildQuery: () => 'List all your available skills. For each skill, give me its name and a one-line description of what it does. Format as a bulleted list.',
  },
  skill: {
    preset: null,
    label: 'Run Skill',
    desc: 'Run a Zo skill on the current page (e.g., !skill cc-awareness-video)',
    buildQuery: (args) => args
      ? `Run the skill named "${args}" using the content from this page as input.`
      : 'Please specify a skill name. Type `!skills` to see available skills.',
  },
  autos: {
    preset: null,
    label: 'Automations',
    desc: 'List your scheduled Zo automations',
    buildQuery: () => 'List all my scheduled automations with their titles, schedules, and delivery methods.',
  },
};

// Returns { handled, query, preset } or { handled: false }
// If handled is true but query is null, the command produced an inline reply
// (e.g. !help) and sendQuery should abort after showing it.
export function parseBangCommand(rawQuery) {
  if (!rawQuery || rawQuery[0] !== '!') return { handled: false, kind: 'passthrough' };

  const trimmed = rawQuery.slice(1).trim();
  const spaceIdx = trimmed.indexOf(' ');
  const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx).toLowerCase();
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

  // !help — list commands inline
  if (name === 'help' || name === 'commands' || name === '?') {
    const lines = ['**Quick Commands** (type these in the chat):'];
    for (const [cmd, def] of Object.entries(BANG_COMMANDS)) {
      lines.push(`• \`!${cmd}\` — ${def.desc}`);
    }
    lines.push('• `!save` — Save this page to your Zo workspace as markdown');
    lines.push('• `!help` — Show this list');
    return { handled: true, kind: 'inline', inlineReply: lines.join('\n') };
  }

  // !save — save page to Zo workspace as markdown
  if (name === 'save') {
    const savePath = args || ''; // optional filename/path argument
    return { handled: true, kind: 'save', isSave: true, savePath };
  }

  // !auto — create a Zo automation/agent from the current page (#08)
  if (name === 'auto') {
    const instruction = args || '';
    if (!instruction) {
      return {
        handled: true, kind: 'inline',
        inlineReply: 'Usage: `!auto <instruction>` — e.g., `!auto summarize this page every day at 9am`. Creates a persistent Zo automation that runs on a schedule.',
      };
    }
    return { handled: true, kind: 'automation', isAuto: true, instruction };
  }

  // Look up the command
  const cmd = BANG_COMMANDS[name];
  if (!cmd) {
    return {
      handled: true, kind: 'inline',
      inlineReply: `Unknown command: \`!${name}\`. Type \`!help\` to see available commands.`,
    };
  }

  return {
    handled: true, kind: 'command',
    query: cmd.buildQuery(args),
    preset: cmd.preset, // may be null for non-preset commands like !fill
  };
}
