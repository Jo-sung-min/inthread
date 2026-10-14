const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/lib/dashboard-stats.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = new Module(filename, module);
loaded._compile(compiled, filename);
const { buildDashboardStats } = loaded.exports;
const now = new Date('2026-10-13T15:30:00Z'); // October 14, 00:30 in Seoul.
const post = (overrides = {}) => ({
  id: 'draft', platform: 'THREADS', text: '본문', mediaUrl: null, status: 'DRAFT',
  scheduledAt: null, createdAt: '2026-10-13T15:00:00Z', updatedAt: '2026-10-13T15:00:00Z',
  ...overrides,
});

test('uses Korean calendar dates at midnight and includes exactly seven days', () => {
  const stats = buildDashboardStats([
    post({ createdAt: '2026-10-07T14:59:59.999Z' }), // October 7, excluded.
    post({ createdAt: '2026-10-07T15:00:00Z' }), // October 8, included.
    post({ createdAt: '2026-10-13T14:59:59.999Z' }),
    post({ createdAt: '2026-10-14T00:00:00+09:00' }),
    post({ createdAt: '2026-10-14T00:20:00+09:00' }),
  ], now);
  assert.deepEqual(stats.last7Days.map(day => day.date), [
    '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14',
  ]);
  assert.deepEqual(stats.last7Days.map(day => day.count), [1, 0, 0, 0, 0, 1, 2]);
  assert.equal(stats.createdLast7Days, 4);
  assert.equal(stats.total, 5);
});

test('counts complete publications separately from partial, unknown, failed and simulated results', () => {
  const statuses = ['PUBLISHED', 'DRAFT', 'PUBLISH_PARTIAL', 'PUBLISH_UNKNOWN', 'PUBLISH_FAILED', 'SIMULATED', 'SCHEDULED', 'PUBLISHING'];
  const stats = buildDashboardStats(statuses.map(status => post({
    status, segments: ['하나', '둘', '셋', '넷'], publishedIds: status === 'PUBLISHED' ? ['1', '2', '3', '4'] : [],
  })), now);
  assert.equal(stats.total, 8);
  assert.equal(stats.published, 1);
  assert.equal(stats.drafts, 1);
  assert.equal(stats.attention, 3);
  assert.equal(stats.createdLast7Days, 8);
});

test('channel distribution includes older content and counts each four-part series once', () => {
  const stats = buildDashboardStats([
    post({ platform: 'INSTAGRAM', createdAt: '2025-01-01T00:00:00Z' }),
    post({ segments: ['첫째', '둘째', '셋째', '넷째'] }), post(),
  ], now);
  assert.deepEqual(stats.channels.map(channel => [channel.platform, channel.count]), [['INSTAGRAM', 1], ['THREADS', 2]]);
  assert.ok(Math.abs(stats.channels[0].percentage - 100 / 3) < 0.0001);
  assert.ok(Math.abs(stats.channels[1].percentage - 200 / 3) < 0.0001);
  assert.equal(stats.createdLast7Days, 2);
});

test('empty workspaces have seven zero buckets and zero percentages without NaN', () => {
  const stats = buildDashboardStats([], now);
  assert.equal(stats.total, 0);
  assert.equal(stats.published, 0);
  assert.equal(stats.drafts, 0);
  assert.equal(stats.attention, 0);
  assert.equal(stats.createdLast7Days, 0);
  assert.equal(stats.last7Days.length, 7);
  assert.ok(stats.last7Days.every(day => day.count === 0));
  assert.ok(stats.channels.every(channel => channel.count === 0 && channel.percentage === 0));
});

test('invalid timestamps and future records do not corrupt daily buckets', () => {
  const stats = buildDashboardStats([
    post({ createdAt: 'not-a-date' }),
    post({ createdAt: '2026-10-13T15:30:01Z' }),
    post({ createdAt: '2026-10-14T15:30:00Z' }),
    post(),
  ], now);
  assert.equal(stats.total, 4);
  assert.equal(stats.drafts, 4);
  assert.equal(stats.createdLast7Days, 1);
  assert.equal(stats.last7Days[6].count, 1);
});

test('calendar iteration crosses a leap day and year boundary without local timezone dependence', () => {
  const leap = buildDashboardStats([post({ createdAt: '2024-02-29T13:00:00Z' })], new Date('2024-03-01T00:00:00+09:00'));
  assert.deepEqual(leap.last7Days.map(day => day.date), ['2024-02-24', '2024-02-25', '2024-02-26', '2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01']);
  assert.equal(leap.last7Days[5].count, 1);
  const year = buildDashboardStats([], new Date('2027-01-01T00:00:00+09:00'));
  assert.equal(year.last7Days[0].date, '2026-12-26');
  assert.equal(year.last7Days[6].date, '2027-01-01');
});
