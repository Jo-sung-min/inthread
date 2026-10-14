import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createBackendClient } from '../src/backend.mjs';
import { createServer } from '../src/server.mjs';

const postId = '12c1db88-3c2e-4eaa-b169-04b0ddaf2a41';
const apiKey = 'test-only-key';

async function connect(t, options = {}) {
  const handler = createMcpHandler(() => createServer({ apiKey, ...options }));
  const client = new Client({ name: 'insauto-test', version: '1.0.0' }, {
    versionNegotiation: { mode: 'auto' },
  });
  t.after(async () => {
    await client.close();
    await handler.close();
  });
  const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  });
  await client.connect(transport);
  return client;
}

test('real SDK discovers fifteen tools and distinguishes real publishing from previews and simulations', async (t) => {
  const client = await connect(t, { fetchImpl: async () => Response.json({}) });
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'get_status', 'list_channels', 'list_posts', 'list_activity',
    'create_draft', 'update_draft', 'schedule_post', 'cancel_schedule', 'simulate_post',
    'list_connections', 'preview_daily_fortune', 'publish_post',
    'get_content_options', 'generate_saju_content', 'create_draft_batch',
  ].sort());
  for (const tool of tools) {
    const isRead = tool.name.startsWith('list_') || ['get_status', 'preview_daily_fortune', 'get_content_options', 'generate_saju_content'].includes(tool.name);
    assert.equal(tool.annotations.readOnlyHint, isRead);
    assert.equal(tool.annotations.openWorldHint, tool.name === 'publish_post');
    if (!isRead) assert.match(tool.description, /dry-run|DRAFT/);
  }
  assert.equal(tools.find((tool) => tool.name === 'update_draft').annotations.destructiveHint, true);
  const publish = tools.find((tool) => tool.name === 'publish_post');
  assert.equal(publish.annotations.destructiveHint, true);
  assert.equal(publish.annotations.idempotentHint, false);
  assert.match(publish.description, /Never retry/);
  assert.match(publish.description, /ALL final segments/);
  assert.match(publish.description, /cannot be rolled back/);
  assert.equal(tools.find((tool) => tool.name === 'create_draft_batch').annotations.idempotentHint, true);
  assert.ok(!tools.some((tool) => /oauth|token|connect_account/.test(tool.name)));
});

test('SDK calls preserve API contracts, bearer authentication, dates, and arrays', async (t) => {
  const requests = [];
  const client = await connect(t, {
    baseUrl: 'http://127.0.0.1:8081/api/v1/',
    fetchImpl: async (url, init) => {
      requests.push({ url, ...init, body: init.body && JSON.parse(init.body) });
      return Response.json(url.endsWith('/posts') && init.method === 'GET' ? [{ id: postId }] : { id: postId });
    },
  });
  const listed = await client.callTool({ name: 'list_posts', arguments: {} });
  assert.deepEqual(listed.structuredContent, { data: [{ id: postId }] });
  await client.callTool({ name: 'get_status', arguments: {} });
  await client.callTool({ name: 'list_channels', arguments: {} });
  await client.callTool({ name: 'list_activity', arguments: {} });
  await client.callTool({ name: 'create_draft', arguments: { platform: 'THREADS', text: 'A draft' } });
  const scheduledAt = '2030-10-15T09:00:00+09:00';
  await client.callTool({ name: 'schedule_post', arguments: { postId, scheduledAt } });
  await client.callTool({ name: 'cancel_schedule', arguments: { postId } });
  await client.callTool({ name: 'simulate_post', arguments: { postId } });
  assert.deepEqual(requests.map(({ url, method }) => [new URL(url).pathname, method]), [
    ['/api/v1/posts', 'GET'], ['/api/v1/health', 'GET'], ['/api/v1/channels', 'GET'], ['/api/v1/activity', 'GET'],
    ['/api/v1/posts', 'POST'], [`/api/v1/posts/${postId}/schedule`, 'POST'],
    [`/api/v1/posts/${postId}/cancel-schedule`, 'POST'], [`/api/v1/posts/${postId}/dry-run`, 'POST'],
  ]);
  assert.deepEqual(requests[4].body, { platform: 'THREADS', text: 'A draft' });
  assert.deepEqual(requests[5].body, { scheduledAt });
  assert.ok(requests.every((request) => request.headers.Authorization === `Bearer ${apiKey}`));
  assert.ok(requests.every((request) => request.redirect === 'error'));
});

test('invalid tool input is rejected by the SDK before any backend request', async (t) => {
  let calls = 0;
  const client = await connect(t, {
    fetchImpl: async () => { calls += 1; return Response.json({}); },
  });
  for (const request of [
    { name: 'create_draft', arguments: { platform: 'FACEBOOK', text: 'No' } },
    { name: 'create_draft', arguments: { platform: 'THREADS', text: '   ' } },
    { name: 'create_draft', arguments: { platform: 'THREADS', text: 'a'.repeat(501) } },
    { name: 'create_draft', arguments: { platform: 'INSTAGRAM', text: 'Hi', mediaUrl: 'file:///private.jpg' } },
    { name: 'update_draft', arguments: { postId, text: 'a'.repeat(2201) } },
    { name: 'update_draft', arguments: { postId, text: 'Changed', platform: 'THREADS' } },
    { name: 'schedule_post', arguments: { postId, scheduledAt: '2030-10-15T09:00:00' } },
    { name: 'simulate_post', arguments: { postId: '../health' } },
  ]) {
    assert.equal((await client.callTool(request)).isError, true);
  }
  assert.equal(calls, 0);
});

test('draft validation counts emoji as Unicode code points like the backend', async (t) => {
  let saved;
  const client = await connect(t, {
    fetchImpl: async (_url, init) => {
      saved = JSON.parse(init.body);
      return Response.json({ id: postId, ...saved });
    },
  });
  const text = '😀'.repeat(2200);
  const result = await client.callTool({ name: 'create_draft', arguments: { platform: 'INSTAGRAM', text } });
  assert.notEqual(result.isError, true);
  assert.equal(saved.text, text);
});

test('draft updates replace text and media using PATCH, preserving omitted and null clearing semantics', async (t) => {
  const requests = [];
  const client = await connect(t, {
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, method: init.method, body });
      return Response.json({ id: postId, status: 'DRAFT', ...body });
    },
  });
  const text = '😀'.repeat(2200);
  const result = await client.callTool({ name: 'update_draft', arguments: { postId, text, mediaUrl: 'https://example.com/image.jpg' } });
  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent.data.status, 'DRAFT');
  await client.callTool({ name: 'update_draft', arguments: { postId, text: 'Remove image' } });
  await client.callTool({ name: 'update_draft', arguments: { postId, text: 'Explicit removal', mediaUrl: null } });
  assert.ok(requests.every((request) => request.method === 'PATCH' && new URL(request.url).pathname === `/api/v1/posts/${postId}`));
  assert.deepEqual(requests.map((request) => request.body), [
    { text, mediaUrl: 'https://example.com/image.jpg' },
    { text: 'Remove image' },
    { text: 'Explicit removal', mediaUrl: null },
  ]);
});

test('backend conflicts become tool errors and redact the configured credential', async (t) => {
  const client = await connect(t, {
    fetchImpl: async () => Response.json({ detail: `Cannot simulate SCHEDULED post ${apiKey}` }, { status: 409 }),
  });
  const result = await client.callTool({ name: 'simulate_post', arguments: { postId } });
  assert.equal(result.isError, true);
  const error = JSON.parse(result.content[0].text);
  assert.equal(error.status, 409);
  assert.equal(error.code, 'BACKEND_HTTP_ERROR');
  assert.match(error.message, /Cannot simulate/);
  assert.ok(!error.message.includes(apiKey));
});

test('connections and fortune preview preserve lunar dates, null time and backend results without saving drafts', async (t) => {
  const requests = [];
  const connection = { platform: 'THREADS', connected: true, username: 'owner', accountId: '123', expiresAt: '2030-11-01T00:00:00Z', oauthConfigured: true, configurationMessage: null };
  const preview = { date: '2030-10-15', basis: 'Calendar basis', notice: 'Entertainment only', chart: { year: 'A', month: 'B', day: 'C', hour: null, dayElement: 'wood' }, reading: { overall: 'a', relationship: 'b', work: 'c', money: 'd', action: 'e' }, instagramText: 'Instagram text', threadsText: 'Threads text' };
  const client = await connect(t, {
    fetchImpl: async (url, init) => {
      requests.push({ path: new URL(url).pathname, method: init.method, body: init.body && JSON.parse(init.body) });
      return Response.json(url.endsWith('/connections') ? [connection] : preview);
    },
  });
  assert.deepEqual((await client.callTool({ name: 'list_connections', arguments: {} })).structuredContent.data, [connection]);
  const input = { birthDate: '2000-02-30', birthTime: null, calendarType: 'LUNAR', leapMonth: false };
  const result = await client.callTool({ name: 'preview_daily_fortune', arguments: input });
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.structuredContent.data, preview);
  assert.deepEqual(requests, [
    { path: '/api/v1/connections', method: 'GET', body: undefined },
    { path: '/api/v1/fortunes/preview', method: 'POST', body: input },
  ]);
});

test('real publishing requires explicit approval, target account and current draft version before a request', async (t) => {
  const requests = [];
  const published = { id: postId, status: 'PUBLISHED', publishedId: 'external-id', permalink: 'https://www.threads.com/@owner/post/test', publishError: null };
  const client = await connect(t, {
    fetchImpl: async (url, init) => {
      requests.push({ path: new URL(url).pathname, method: init.method, body: JSON.parse(init.body) });
      return Response.json(published);
    },
  });
  const approved = { postId, accountId: '123', expectedUpdatedAt: '2030-10-15T09:00:00.123456789+09:00', confirmPublication: true };
  for (const args of [
    { ...approved, confirmPublication: undefined },
    { ...approved, confirmPublication: false },
    { ...approved, accountId: undefined },
    { ...approved, expectedUpdatedAt: undefined },
    { ...approved, expectedUpdatedAt: '2030-10-15T09:00:00' },
    { ...approved, unexpectedToken: 'never-accept-secrets' },
  ]) {
    assert.equal((await client.callTool({ name: 'publish_post', arguments: args })).isError, true);
  }
  assert.equal(requests.length, 0);
  const result = await client.callTool({ name: 'publish_post', arguments: approved });
  assert.deepEqual(result.structuredContent.data, published);
  assert.deepEqual(requests, [{ path: `/api/v1/posts/${postId}/publish`, method: 'POST', body: { accountId: '123', expectedUpdatedAt: approved.expectedUpdatedAt } }]);
});

test('content generation forwards catalog choices and returns previews without saving or publishing', async (t) => {
  const requests = [];
  const options = { topics: [{ id: 'LATE_BLOOM', label: 'Late bloom', description: 'A topic' }], devices: [], tones: [{ id: 'DIRECT', label: 'Direct' }], maxBatchSize: 12 };
  const preview = { generator: 'TEMPLATE', generatedAt: '2030-10-15T00:00:00Z', items: [{ id: postId, topicId: 'LATE_BLOOM', title: 'A title', segments: ['One', 'Two', 'Three', 'Four'], instagramCaption: 'Caption', devices: [], tone: 'DIRECT' }], notice: 'Template interpretation' };
  const client = await connect(t, {
    fetchImpl: async (url, init) => {
      requests.push({ path: new URL(url).pathname, method: init.method, body: init.body && JSON.parse(init.body) });
      return Response.json(url.endsWith('/options') ? options : preview);
    },
  });
  assert.deepEqual((await client.callTool({ name: 'get_content_options', arguments: {} })).structuredContent.data, options);
  const input = { topicIds: ['LATE_BLOOM'], count: 1, tone: 'DIRECT', devices: [], cta: 'SAVE' };
  assert.deepEqual((await client.callTool({ name: 'generate_saju_content', arguments: input })).structuredContent.data, preview);
  assert.deepEqual(requests, [
    { path: '/api/v1/content-studio/options', method: 'GET', body: undefined },
    { path: '/api/v1/content-studio/generate', method: 'POST', body: input },
  ]);
  for (const invalid of [{ ...input, count: 13 }, { ...input, topicIds: [] }, { ...input, tone: 'INVENTED' }]) {
    assert.equal((await client.callTool({ name: 'generate_saju_content', arguments: invalid })).isError, true);
  }
  assert.equal(requests.length, 2);
});

test('series draft and batch tools preserve all four parts and the exact idempotency key', async (t) => {
  const requests = [];
  const parts = ['First', 'Second', 'Third', 'Fourth'];
  const draft = { platform: 'THREADS', text: parts[0], segments: parts };
  const input = { requestId: '94abaf7b-a3c2-478e-9b96-4f89c582df5e', posts: [draft] };
  const saved = { id: postId, status: 'DRAFT', ...draft, publishedIds: [] };
  const client = await connect(t, {
    fetchImpl: async (url, init) => {
      requests.push({ path: new URL(url).pathname, method: init.method, body: JSON.parse(init.body) });
      return Response.json(url.endsWith('/batch') ? { posts: [saved] } : saved);
    },
  });
  assert.deepEqual((await client.callTool({ name: 'create_draft_batch', arguments: input })).structuredContent.data, { posts: [saved] });
  await client.callTool({ name: 'create_draft_batch', arguments: input });
  await client.callTool({ name: 'create_draft', arguments: draft });
  await client.callTool({ name: 'update_draft', arguments: { postId, text: parts[0], segments: parts } });
  await client.callTool({ name: 'update_draft', arguments: { postId, text: 'Changed first only' } });
  await client.callTool({ name: 'update_draft', arguments: { postId, text: 'Single post now', segments: [] } });
  assert.deepEqual(requests, [
    { path: '/api/v1/posts/batch', method: 'POST', body: input },
    { path: '/api/v1/posts/batch', method: 'POST', body: input },
    { path: '/api/v1/posts', method: 'POST', body: draft },
    { path: `/api/v1/posts/${postId}`, method: 'PATCH', body: { text: parts[0], segments: parts } },
    { path: `/api/v1/posts/${postId}`, method: 'PATCH', body: { text: 'Changed first only' } },
    { path: `/api/v1/posts/${postId}`, method: 'PATCH', body: { text: 'Single post now', segments: [] } },
  ]);
  for (const invalid of [
    { name: 'create_draft_batch', arguments: { ...input, posts: [] } },
    { name: 'create_draft_batch', arguments: { ...input, posts: Array(13).fill(draft) } },
    { name: 'create_draft', arguments: { ...draft, segments: parts.slice(0, 3) } },
    { name: 'update_draft', arguments: { postId, text: 'First', segments: ['First', 'Second', 'Third', 'a'.repeat(501)] } },
  ]) assert.equal((await client.callTool(invalid)).isError, true);
  assert.equal(requests.length, 6);
});

test('partial chain receipts pass through without automatically resuming or repeating publication', async (t) => {
  let calls = 0;
  const partial = { id: postId, status: 'PUBLISH_PARTIAL', publishedId: '100', publishedIds: ['100', '101'], segments: ['One', 'Two', 'Three', 'Four'], publishError: 'Stopped before publishing part 3.' };
  const client = await connect(t, { fetchImpl: async () => { calls += 1; return Response.json(partial); } });
  const result = await client.callTool({ name: 'publish_post', arguments: { postId, accountId: '123', expectedUpdatedAt: '2030-10-15T00:00:00Z', confirmPublication: true } });
  assert.deepEqual(result.structuredContent.data, partial);
  assert.equal(calls, 1);
});

test('publication supports a six-minute backend deadline without relaxing normal request timeouts', async () => {
  let calls = 0;
  const backend = createBackendClient({ apiKey, fetchImpl: async () => { calls += 1; return Response.json({}); } });
  await backend.request('/posts/test/publish', { method: 'POST', requestTimeoutMs: 360_000 });
  await assert.rejects(backend.request('/posts/test/publish', { requestTimeoutMs: 360_001 }), /360000/);
  assert.throws(() => createBackendClient({ apiKey, timeoutMs: 360_000 }), /30000/);
  assert.equal(calls, 1);
});

test('unknown publication state and structured backend conflicts are returned without automatic retries', async (t) => {
  let calls = 0;
  const client = await connect(t, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return Response.json({ id: postId, status: 'PUBLISH_UNKNOWN', publishError: 'Check the target platform before any further publication.', publishedId: null, permalink: null });
      return Response.json({ code: 'ACCOUNT_CHANGED', detail: 'The connected account changed.' }, { status: 409 });
    },
  });
  const request = { name: 'publish_post', arguments: { postId, accountId: '123', expectedUpdatedAt: '2030-10-15T00:00:00Z', confirmPublication: true } };
  const unknown = await client.callTool(request);
  assert.equal(unknown.structuredContent.data.status, 'PUBLISH_UNKNOWN');
  assert.equal(calls, 1);
  const conflict = await client.callTool(request);
  assert.equal(conflict.isError, true);
  assert.deepEqual(JSON.parse(conflict.content[0].text), { code: 'ACCOUNT_CHANGED', message: 'The connected account changed.', status: 409 });
  assert.equal(calls, 2);
});

test('lost publish response is attempted once and tells callers to inspect before retrying', async (t) => {
  let calls = 0;
  const client = await connect(t, {
    fetchImpl: async () => { calls += 1; throw new Error('socket closed'); },
  });
  const result = await client.callTool({ name: 'publish_post', arguments: { postId, accountId: '123', expectedUpdatedAt: '2030-10-15T00:00:00Z', confirmPublication: true } });
  assert.equal(result.isError, true);
  assert.equal(calls, 1);
  assert.match(JSON.parse(result.content[0].text).message, /never retry publication automatically/);
});

test('backend deadline aborts stalled requests without automatic retries', async () => {
  let calls = 0;
  const backend = createBackendClient({
    apiKey,
    timeoutMs: 20,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      calls += 1;
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  await assert.rejects(backend.request('/posts', { method: 'POST', body: {} }), {
    code: 'BACKEND_TIMEOUT',
  });
  assert.equal(calls, 1);
});

test('missing credentials fail early and invalid JSON becomes a typed backend error', async () => {
  assert.throws(() => createBackendClient({ apiKey: '' }), /Set INSAUTO_API_KEY/);
  const backend = createBackendClient({ apiKey, fetchImpl: async () => new Response('<html>oops</html>') });
  await assert.rejects(backend.request('/health'), { code: 'INVALID_BACKEND_RESPONSE' });
});

test('stdio entrypoint completes a real SDK handshake and tool discovery', async (t) => {
  const client = new Client({ name: 'insauto-stdio-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/index.mjs', import.meta.url))],
    env: { ...process.env, INSAUTO_API_KEY: apiKey },
    stderr: 'pipe',
  }));
  assert.equal((await client.listTools()).tools.length, 15);
});
