const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { NextRequest, NextResponse } = require('next/server');
const { createHmac } = require('node:crypto');

// Compile the actual route sources in memory, without opening an HTTP listener.
function loadSource(relativePath, overrides = {}) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = function (id) { return Object.hasOwn(overrides, id) ? overrides[id] : Module.prototype.require.call(this, id); };
  loaded._compile(compiled, filename);
  return loaded.exports;
}
const server = loadSource('src/lib/server-api.ts');
const callback = loadSource('src/app/api/oauth/[platform]/callback/route.ts', { '@/lib/server-api': server });
const start = loadSource('src/app/api/oauth/[platform]/start/route.ts', { '@/lib/server-api': server });
const proxy = loadSource('src/app/api/backend/[...path]/route.ts', { '@/lib/server-api': server });
const saved = { password: process.env.INSAUTO_SITE_PASSWORD, origin: process.env.FRONTEND_ORIGIN };
const realBackend = server.backend;
const context = { params: Promise.resolve({ platform: 'threads' }) };

function request(route = '/api/backend/posts', { host = '127.0.0.1:3001', origin, method = 'GET', cookie, body, contentType } = {}) {
  const headers = { host };
  if (origin !== undefined) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  if (contentType) headers['content-type'] = contentType;
  return new NextRequest(`http://127.0.0.1:3001${route}`, { method, headers, ...(body !== undefined ? { body } : {}) });
}
beforeEach(() => { delete process.env.INSAUTO_SITE_PASSWORD; delete process.env.FRONTEND_ORIGIN; server.backend = realBackend; });
afterEach(() => {
  if (saved.password === undefined) delete process.env.INSAUTO_SITE_PASSWORD; else process.env.INSAUTO_SITE_PASSWORD = saved.password;
  if (saved.origin === undefined) delete process.env.FRONTEND_ORIGIN; else process.env.FRONTEND_ORIGIN = saved.origin;
  server.backend = realBackend;
});

test('local Host and exact Origin are both required for JSON mutations', () => {
  assert.equal(server.guard(request()), null);
  const good = { method: 'POST', origin: 'http://127.0.0.1:3001', contentType: 'application/json', body: '{}' };
  assert.equal(server.guard(request(undefined, good), true), null);
  assert.equal(server.guard(request(undefined, { ...good, origin: 'https://evil.example' }), true).status, 403);
  assert.equal(server.guard(request(undefined, { ...good, origin: undefined }), true).status, 403);
  assert.equal(server.guard(request(undefined, { ...good, origin: 'http://localhost:3001' }), true).status, 403);
  assert.equal(server.guard(request(undefined, { ...good, contentType: 'text/plain' }), true).status, 415);
  assert.equal(server.guard(request(undefined, { host: 'evil.example' })).status, 403);
});

test('public origin never unlocks local or public requests without a valid password', () => {
  process.env.FRONTEND_ORIGIN = 'https://workspace.example';
  assert.equal(server.guard(request()).status, 401);
  assert.equal(server.guard(request(undefined, { host: 'workspace.example' })).status, 401);
  process.env.INSAUTO_SITE_PASSWORD = 'short';
  assert.equal(server.guard(request()).status, 401);
  process.env.INSAUTO_SITE_PASSWORD = 'a-long-random-test-password';
  assert.equal(server.guard(request()).status, 401);
});

test('signed session requires the current password, rejects tampering and expiry', () => {
  process.env.INSAUTO_SITE_PASSWORD = 'a-long-random-test-password';
  const response = NextResponse.json({ ok: true });
  server.establishSession(response);
  const value = response.cookies.get('insauto_session').value;
  const cookie = `insauto_session=${value}`;
  assert.equal(server.guard(request(undefined, { cookie })), null);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /Secure/);
  assert.match(response.headers.get('set-cookie'), /SameSite=lax/i);
  assert.equal(server.guard(request(undefined, { cookie: `insauto_session=${value}tampered` })).status, 401);
  const payload = `${Math.floor(Date.now() / 1000) - 9 * 3600}.${'a'.repeat(32)}`;
  const signature = createHmac('sha256', process.env.INSAUTO_SITE_PASSWORD).update(payload).digest('base64url');
  assert.equal(server.guard(request(undefined, { cookie: `insauto_session=${payload}.${signature}` })).status, 401);
  process.env.INSAUTO_SITE_PASSWORD = 'a-different-password-for-rotation';
  assert.equal(server.guard(request(undefined, { cookie })).status, 401);
});

test('OAuth state mismatch rejects before backend exchange and clears the cookie', async () => {
  let called = false;
  server.backend = async () => { called = true; throw new Error('must not exchange'); };
  const response = await callback.GET(request('/api/oauth/threads/callback?code=private-code&state=wrong-state', { cookie: 'insauto_oauth_threads=right-state' }), context);
  assert.equal(response.status, 303);
  assert.equal(called, false);
  assert.match(response.headers.get('location'), /reason=state/);
  assert.doesNotMatch(response.headers.get('location'), /private-code|wrong-state|right-state/);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});

test('OAuth callback requires the public workspace session before exchange', async () => {
  process.env.INSAUTO_SITE_PASSWORD = 'a-long-random-test-password';
  let called = false;
  server.backend = async () => { called = true; return Response.json({ connected: true }); };
  const response = await callback.GET(request('/api/oauth/threads/callback?code=private-code&state=matching-state', { cookie: 'insauto_oauth_threads=matching-state' }), context);
  assert.equal(called, false);
  assert.match(response.headers.get('location'), /reason=session/);
});

test('OAuth callback exchanges only matching state and never exposes codes', async () => {
  let called;
  server.backend = async (...args) => { called = args; return Response.json({ connected: true }); };
  const response = await callback.GET(request('/api/oauth/threads/callback?code=private-code&state=matching-state', { cookie: 'insauto_oauth_threads=matching-state' }), context);
  assert.equal(called[0], 'connections/THREADS/oauth/complete');
  assert.deepEqual(JSON.parse(called[2]), { code: 'private-code', state: 'matching-state' });
  assert.equal(called[3], 40000);
  assert.match(response.headers.get('location'), /connection=success/);
  assert.doesNotMatch(response.headers.get('location'), /private-code|matching-state/);
});

test('OAuth start binds a secure callback cookie to the active site origin', async () => {
  const state = 'a'.repeat(40);
  server.backend = async () => Response.json({ state, authorizationUrl: `https://www.threads.net/oauth/authorize?state=${state}&redirect_uri=${encodeURIComponent('http://127.0.0.1:3001/api/oauth/threads/callback')}` });
  const response = await start.POST(request('/api/oauth/threads/start', { method: 'POST', origin: 'http://127.0.0.1:3001', contentType: 'application/json', body: '{}' }), context);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /Path=\/api\/oauth\/threads\/callback/);
  assert.match(cookie, /Max-Age=600/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  server.backend = async () => Response.json({ state, authorizationUrl: `https://www.threads.net/oauth/authorize?state=${state}&redirect_uri=${encodeURIComponent('http://localhost:3001/api/oauth/threads/callback')}` });
  const rejected = await start.POST(request('/api/oauth/threads/start', { method: 'POST', origin: 'http://127.0.0.1:3001', contentType: 'application/json', body: '{}' }), context);
  assert.equal(rejected.status, 409);
});

test('generic proxy cannot bypass OAuth binding and handles disconnect 204', async () => {
  let count = 0;
  server.backend = async () => { count += 1; return new Response(null, { status: 204 }); };
  const init = { method: 'POST', origin: 'http://127.0.0.1:3001', contentType: 'application/json', body: '{}' };
  const denied = await proxy.POST(request('/api/backend/connections/THREADS/oauth/complete', init), { params: Promise.resolve({ path: ['connections', 'THREADS', 'oauth', 'complete'] }) });
  assert.equal(denied.status, 404);
  assert.equal(count, 0);
  const disconnected = await proxy.DELETE(request('/api/backend/connections/THREADS', { ...init, method: 'DELETE' }), { params: Promise.resolve({ path: ['connections', 'THREADS'] }) });
  assert.equal(disconnected.status, 204);
  assert.equal(await disconnected.text(), '');
});

test('mutation reader bounds chunked body size and rejects invalid JSON', async () => {
  const tooLarge = await server.readBody(request(undefined, { method: 'POST', body: 'x'.repeat(16385) }));
  assert.equal(tooLarge.status, 413);
  const invalid = await server.readBody(request(undefined, { method: 'POST', body: 'not json' }));
  assert.equal(invalid.status, 400);
});

test('login rate limiter stops repeated attempts within its window', () => {
  const host = `test-${Date.now()}`;
  for (let i = 0; i < 8; i++) assert.equal(server.loginAllowed(host), true);
  assert.equal(server.loginAllowed(host), false);
});
test('login route issues a protected session and logout clears it', async () => {
  process.env.INSAUTO_SITE_PASSWORD = 'a-long-random-test-password';
  const login = loadSource('src/app/api/auth/login/route.ts', { '@/lib/server-api': server });
  const logout = loadSource('src/app/api/auth/logout/route.ts', { '@/lib/server-api': server });
  const init = { method: 'POST', origin: 'http://127.0.0.1:3001', contentType: 'application/json' };
  const denied = await login.POST(request('/api/auth/login', { ...init, body: JSON.stringify({ password: 'wrong-password' }) }));
  assert.equal(denied.status, 401);
  const signedIn = await login.POST(request('/api/auth/login', { ...init, body: JSON.stringify({ password: process.env.INSAUTO_SITE_PASSWORD }) }));
  assert.equal(signedIn.status, 200);
  const cookie = `insauto_session=${signedIn.cookies.get('insauto_session').value}`;
  assert.equal(server.hasSession(request(undefined, { cookie })), true);
  const signedOut = await logout.POST(request('/api/auth/logout', { ...init, body: '{}', cookie }));
  assert.equal(signedOut.status, 204);
  assert.match(signedOut.headers.get('set-cookie'), /Max-Age=0/);
});

test('malformed public configuration fails closed even with a loopback Host', () => {
  process.env.FRONTEND_ORIGIN = 'https://workspace.example/not-an-origin';
  assert.equal(server.guard(request()).status, 401);
  process.env.FRONTEND_ORIGIN = 'not-an-origin';
  assert.equal(server.guard(request()).status, 401);
});
test('public HTTPS OAuth works with a session despite normalized request.url', async () => {
  process.env.FRONTEND_ORIGIN = 'https://workspace.example';
  process.env.INSAUTO_SITE_PASSWORD = 'a-long-random-test-password';
  const sessionResponse = NextResponse.json({ ok: true });
  server.establishSession(sessionResponse);
  const sessionCookie = `insauto_session=${sessionResponse.cookies.get('insauto_session').value}`;
  const state = 'p'.repeat(40);
  const redirectUri = 'https://workspace.example/api/oauth/threads/callback';
  server.backend = async () => Response.json({ state, authorizationUrl: `https://www.threads.net/oauth/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}` });
  const begun = await start.POST(request('/api/oauth/threads/start', { host: 'workspace.example', origin: 'https://workspace.example', method: 'POST', contentType: 'application/json', body: '{}', cookie: sessionCookie }), context);
  assert.equal(begun.status, 200);
  server.backend = async () => Response.json({ connected: true });
  const completed = await callback.GET(request(`/api/oauth/threads/callback?code=one-time-code&state=${state}`, { host: 'workspace.example', cookie: `${sessionCookie}; insauto_oauth_threads=${state}` }), context);
  assert.equal(completed.headers.get('location'), 'https://workspace.example/connections?connection=success&platform=threads');
});
test('batch uploads allow128KiB while ordinary requests remain capped16KiB', async () => {
  const sample = JSON.stringify({ requestId: '00000000-0000-4000-8000-000000000000', posts: Array.from({ length: 12 }, () => ({ platform: 'THREADS', text: '한'.repeat(500), segments: Array(4).fill('한'.repeat(500)), mediaUrl: null })) });
  assert.ok(Buffer.byteLength(sample) > 16384);
  assert.ok(Buffer.byteLength(sample) < 131072);
  let forwarded;
  server.backend = async (...args) => { forwarded = args; return Response.json({ posts: [] }, { status: 201 }); };
  const init = { method: 'POST', origin: 'http://127.0.0.1:3001', contentType: 'application/json', body: sample };
  const batch = await proxy.POST(request('/api/backend/posts/batch', init), { params: Promise.resolve({ path: ['posts', 'batch'] }) });
  assert.equal(batch.status, 201);
  assert.equal(forwarded[0], 'posts/batch');
  const ordinary = await proxy.POST(request('/api/backend/posts', init), { params: Promise.resolve({ path: ['posts'] }) });
  assert.equal(ordinary.status, 413);
});

test('content studio routes are allowed and series publishing has a bounded6minute timeout', async () => {
  const calls = [];
  server.backend = async (...args) => { calls.push(args); return Response.json({}); };
  const catalog = await proxy.GET(request('/api/backend/content-studio/options'), { params: Promise.resolve({ path: ['content-studio', 'options'] }) });
  assert.equal(catalog.status, 200);
  const init = { method: 'POST', origin: 'http://127.0.0.1:3001', contentType: 'application/json', body: '{}' };
  await proxy.POST(request('/api/backend/content-studio/generate', init), { params: Promise.resolve({ path: ['content-studio', 'generate'] }) });
  const id = '00000000-0000-4000-8000-000000000000';
  await proxy.POST(request(`/api/backend/posts/${id}/publish`, init), { params: Promise.resolve({ path: ['posts', id, 'publish'] }) });
  assert.equal(calls[0][0], 'content-studio/options');
  assert.equal(calls[1][0], 'content-studio/generate');
  assert.equal(calls[2][3], 360000);
});

test('selected batch save reuses a request id only for identical payloads', () => {
  const studio = loadSource('src/lib/content-studio.ts');
  const items = [{ id: 'item1', segments: ['첫 문단', '둘째 문단', '셋째 문단', '마지막 문단'] }];
  const posts = studio.batchPosts(items, 'THREADS');
  let generated = 0;
  const createId = () => `id-${++generated}`;
  const first = studio.identifyBatch(null, posts, createId);
  const retry = studio.identifyBatch(first, studio.batchPosts(items, 'THREADS'), createId);
  assert.equal(retry.requestId, first.requestId);
  assert.equal(generated, 1);
  const changed = studio.identifyBatch(first, studio.batchPosts([{ ...items[0], segments: ['수정한 첫 문단', ...items[0].segments.slice(1)] }], 'THREADS'), createId);
  assert.notEqual(changed.requestId, first.requestId);
  const instagram = studio.batchPosts(items, 'INSTAGRAM');
  assert.equal(instagram[0].text, items[0].segments.join('\n\n'));
  assert.equal(instagram[0].segments, undefined);
});

test('four segment validation counts Unicode characters and rejects empty or oversized parts', () => {
  const studio = loadSource('src/lib/content-studio.ts');
  assert.equal(studio.validSegments(['😀'.repeat(500), '둘', '셋', '넷']), true);
  assert.equal(studio.validSegments(['😀'.repeat(501), '둘', '셋', '넷']), false);
  assert.equal(studio.validSegments([' ', '둘', '셋', '넷']), false);
  assert.equal(studio.validSegments(['하나', '둘', '셋']), false);
});
test('an uncertain batch keeps its original payload when selection and edited text change', () => {
  const studio = loadSource('src/lib/content-studio.ts');
  const original = [
    { id: 'one', segments: ['첫 시리즈', '둘', '셋', '넷'], instagramCaption: 'old' },
    { id: 'two', segments: ['다른 시리즈', '둘', '셋', '넷'], instagramCaption: 'old' },
  ];
  const attempt = studio.createBatchAttempt(original, 'THREADS', null, () => 'original-request');
  original[0].segments[0] = '수정한 새 선택';
  original.splice(1, 1);
  const different = studio.createBatchAttempt(original, 'INSTAGRAM', attempt, () => 'different-request');
  assert.equal(attempt.requestId, 'original-request');
  assert.deepEqual(attempt.sourceIds, ['one', 'two']);
  assert.equal(attempt.posts.length, 2);
  assert.equal(attempt.posts[0].segments[0], '첫 시리즈');
  assert.equal(attempt.posts[0].platform, 'THREADS');
  assert.notEqual(different.requestId, attempt.requestId);
});

test('editing segments invalidates saved markers and Instagram saves the current four parts', () => {
  const studio = loadSource('src/lib/content-studio.ts');
  const original = { id: 'one', segments: ['원래 글', '둘', '셋', '넷'], instagramCaption: 'stale caption' };
  const savedKey = studio.savedVariantKey(original, 'THREADS');
  const edited = { ...original, segments: ['수정된 첫 문단', '수정된 둘째', '셋', '넷'] };
  assert.notEqual(studio.savedVariantKey(edited, 'THREADS'), savedKey);
  assert.equal(studio.savedVariantKey({ ...original, segments: ['  원래 글  ', '둘', '셋', '넷'] }, 'THREADS'), savedKey);
  const instagram = studio.batchPosts([edited], 'INSTAGRAM')[0];
  assert.equal(instagram.text, edited.segments.join('\n\n'));
  assert.equal(instagram.segments, undefined);
  assert.ok(!instagram.text.includes('stale caption'));
});
