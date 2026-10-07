// A stand-in for the Messages API, speaking its streaming SSE format: the
// first turn asks for a repo_read tool call, the next turn answers with text.
// Records every request body and header so tests can assert on them.
import { createServer } from 'node:http';

export function startMockAnthropic() {
  const requests = [];
  const sse = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const chunk = s => s.match(/.{1,7}/gs) || [];
  function stream(res, model, blocks, stop) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    sse(res, 'message_start', { message: { id: 'msg_mock', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } });
    blocks.forEach((b, index) => {
      if (b.type === 'text') { sse(res, 'content_block_start', { index, content_block: { type: 'text', text: '' } }); for (const p of chunk(b.text)) sse(res, 'content_block_delta', { index, delta: { type: 'text_delta', text: p } }); }
      else { sse(res, 'content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }); for (const p of chunk(JSON.stringify(b.input))) sse(res, 'content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: p } }); }
      sse(res, 'content_block_stop', { index });
    });
    sse(res, 'message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 30 } });
    sse(res, 'message_stop', {});
    res.end();
  }
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) { res.writeHead(404); return res.end('{}'); }
    const body = JSON.parse(raw); requests.push({ headers: req.headers, body });
    const last = body.messages[body.messages.length - 1];
    const toolResults = Array.isArray(last.content) ? last.content.filter(b => b.type === 'tool_result') : [];
    if (!toolResults.length) return stream(res, body.model, [{ type: 'tool_use', id: 'toolu_mock_1', name: 'repo_read', input: { path: 'package.json', start: 1, end: 5 } }], 'tool_use');
    const seen = String(toolResults[0].content).includes('"name"') ? 'I read package.json.' : 'I could not read it.';
    return stream(res, body.model, [{ type: 'text', text: `${seen} The package is named gatekeeper-eye. Ask again, and ask better.` }], 'end_turn');
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise(r => server.close(r)) })));
}
