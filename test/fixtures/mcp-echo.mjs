// The smallest possible MCP server over stdio (JSON-RPC, newline-delimited),
// exposing one tool, `echo`. Used to exercise the bridge's MCP client.
import { createInterface } from 'node:readline';

const send = o => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return;   // notification
  switch (m.method) {
    case 'initialize': return send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1.0.0' } } });
    case 'ping': return send({ id: m.id, result: {} });
    case 'tools/list': return send({ id: m.id, result: { tools: [{ name: 'echo', description: 'Echoes the text back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } });
    case 'tools/call': return send({ id: m.id, result: { content: [{ type: 'text', text: `echo: ${m.params?.arguments?.text ?? ''}` }] } });
    default: return send({ id: m.id, error: { code: -32601, message: `unknown method ${m.method}` } });
  }
});
