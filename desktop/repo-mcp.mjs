// The only MCP server used by the restricted Claude oracle. It exposes the
// app's repository boundary, never Claude's unrestricted filesystem/shell tools.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'node:url';
import { resolve, isAbsolute } from 'node:path';
import { repoTools } from './repo-tools.mjs';
import { killAllNow } from './processes.mjs';

export const REPO_MCP_NAME = 'gatekeeper_repo';
export const REPO_TOOL_NAMES = Object.freeze(['repo_list', 'repo_read', 'repo_search', 'repo_git']);

export async function startRepoMcp(root) {
  if (typeof root !== 'string' || !isAbsolute(root)) throw new Error('an absolute repository path is required');
  const tools = new Map(repoTools(root).filter(t => REPO_TOOL_NAMES.includes(t.name)).map(t => [t.name, t]));
  const server = new Server({ name: REPO_MCP_NAME, version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools.values()].map(t => ({
    name: t.name, description: t.description, inputSchema: t.input_schema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  })) }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = tools.get(request.params.name);
    if (!tool) throw new Error('tool not allowed');
    try {
      const result = await tool.call(request.params.arguments || {}, extra.signal);
      return { content: [{ type: 'text', text: String(result) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: String(e?.message || e) }] };
    }
  });
  await server.connect(new StdioServerTransport());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) { process.stderr.write('expected one repository path\n'); process.exitCode = 1; }
  else {
    // Repo subprocesses have their own tracked groups. A normal MCP disconnect
    // or Claude cancellation must clean them up as well as this server process.
    process.once('exit', killAllNow);
    const stop = () => { killAllNow(); process.exit(0); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    process.stdin.once('end', stop);
    await startRepoMcp(process.argv[2]);
  }
}
