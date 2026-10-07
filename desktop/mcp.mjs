// MCP for the API oracle. Reads the same config shape Claude Desktop and Claude
// Code use ({ "mcpServers": { name: { command, args, env } | { url } } }).
//   - stdio servers (command) are started here with the MCP SDK; their tools are
//     offered to Claude as ordinary tools and executed through the client.
//   - remote servers (url) are handed to the Messages API's MCP connector, which
//     connects to them server-side.
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const TOOL_NAME_RE = /[^a-zA-Z0-9_-]/g;

export async function loadMcp(configPath, log = () => {}) {
  const result = { localTools: [], remoteServers: [], close: async () => {} };
  if (!configPath) return result;
  const cfg = JSON.parse(await readFile(configPath, 'utf8'));
  const servers = cfg.mcpServers || {};
  const clients = [], used = new Set();
  for (const [name, def] of Object.entries(servers)) {
    if (!def || typeof def !== 'object') continue;
    if (def.url) {
      result.remoteServers.push({ type: 'url', url: def.url, name, ...(def.authorization_token ? { authorization_token: def.authorization_token } : {}) });
      log(`mcp: ${name}: remote, via the API's MCP connector`);
      continue;
    }
    if (!def.command) { log(`mcp: ${name}: no command or url, skipped`); continue; }
    try {
      const transport = new StdioClientTransport({
        command: def.command, args: def.args || [], cwd: def.cwd,
        env: def.env ? { ...process.env, ...def.env } : undefined, stderr: 'ignore',
      });
      const client = new Client({ name: 'gatekeeper-eye', version: '1.0.0' });
      await client.connect(transport);
      const { tools } = await client.listTools();
      for (const t of tools) {
        let toolName = `${name}__${t.name}`.replace(TOOL_NAME_RE, '_').slice(0, 64);
        for (let i = 2; used.has(toolName); i++) toolName = `${toolName.slice(0, 60)}_${i}`;
        used.add(toolName);
        result.localTools.push({
          name: toolName,
          description: `[${name}] ${t.description || t.name}`.slice(0, 1024),
          input_schema: t.inputSchema || { type: 'object', properties: {} },
          label: () => `${name.toUpperCase()}: ${t.name}`,
          call: async input => textOf(await client.callTool({ name: t.name, arguments: input })),
        });
      }
      clients.push(client);
      log(`mcp: ${name}: ${tools.length} tool${tools.length === 1 ? '' : 's'}`);
    } catch (e) {
      log(`mcp: ${name}: failed to start (${e.message})`);
    }
  }
  result.close = async () => { for (const c of clients) await c.close().catch(() => {}); };
  return result;
}

function textOf(res) {
  const parts = (res.content || []).map(b => b.type === 'text' ? b.text : `[${b.type}]`);
  const s = parts.join('\n').trim();
  if (res.isError) throw new Error(s || 'tool error');
  return s || '(no output)';
}
