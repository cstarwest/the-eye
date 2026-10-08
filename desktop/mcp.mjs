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
  const result = { localTools: [], remoteServers: [], remoteToolsets: [], close: async () => {} };
  if (!configPath) return result;
  const cfg = JSON.parse(await readFile(configPath, 'utf8'));
  const servers = cfg.mcpServers || {};
  const clients = [], used = new Set();
  for (const [name, def] of Object.entries(servers)) {
    if (!def || typeof def !== 'object') continue;
    // Adding a server is not permission to expose every present or future tool.
    // This is an explicit user-configured grant, not a server's readOnlyHint.
    const allowed = Array.isArray(def.allowedTools) && def.allowedTools.every(t => typeof t === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(t))
      ? new Set(def.allowedTools) : new Set();
    if (!allowed.size) { log(`mcp: ${name}: disabled; configure exact allowedTools to grant access`); continue; }
    if (def.url) {
      result.remoteServers.push({ type: 'url', url: def.url, name, ...(def.authorization_token ? { authorization_token: def.authorization_token } : {}) });
      result.remoteToolsets.push({ type: 'mcp_toolset', mcp_server_name: name,
        default_config: { enabled: false },
        configs: Object.fromEntries([...allowed].map(tool => [tool, { enabled: true }])) });
      log(`mcp: ${name}: remote, ${allowed.size} explicitly allowed tool(s)`);
      continue;
    }
    if (!def.command) { log(`mcp: ${name}: no command or url, skipped`); continue; }
    let client, transport;
    try {
      transport = new StdioClientTransport({
        command: def.command, args: def.args || [], cwd: def.cwd,
        env: def.env ? { ...def.env } : undefined, stderr: 'ignore',
      });
      client = new Client({ name: 'gatekeeper-eye', version: '1.0.0' });
      await client.connect(transport);
      const { tools } = await client.listTools();
      let count = 0;
      for (const t of tools) {
        if (!allowed.has(t.name)) continue;
        count++;
        let toolName = `${name}__${t.name}`.replace(TOOL_NAME_RE, '_').slice(0, 64);
        for (let i = 2; used.has(toolName); i++) toolName = `${toolName.slice(0, 60)}_${i}`;
        used.add(toolName);
        result.localTools.push({
          name: toolName,
          description: `[${name}] ${t.description || t.name}`.slice(0, 1024),
          input_schema: t.inputSchema || { type: 'object', properties: {} },
          label: () => `${name.toUpperCase()}: ${t.name}`,
          call: async input => {
            if (!allowed.has(t.name)) throw new Error('MCP tool is not authorized');
            return textOf(await client.callTool({ name: t.name, arguments: input }));
          },
        });
      }
      clients.push(client);
      log(`mcp: ${name}: ${count} tool${count === 1 ? '' : 's'}`);
    } catch (e) {
      await client?.close().catch(() => {});
      await transport?.close().catch(() => {});
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
