import test from 'node:test';
import assert from 'node:assert/strict';
import {CapinfoUsageService} from '../usage-service.js';

// Service registers through ctx.reflect.provide; the value mapping needs nothing else.
const service = snapshot => new CapinfoUsageService({reflect: {provide: () => () => {}}}, {snapshot: () => snapshot});

test('today exposes the same three raw values as the dashboard headline', () => {
  const value = service({date: '2026-11-13', timeZone: 'Asia/Shanghai', totalTokens: 5930000, amount: 0.85,
    amountUpdatedAt: '2026-11-13T09:32:58.000Z', history: [{date: '2026-11-13'}],
    spending: {status: 'ready'}, persistenceError: false}).today();
  assert.deepEqual(value, {amount: 0.85, tokens: 5930000, refreshedAt: '2026-11-13T09:32:58.000Z'});
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes('history'), false);
  assert.equal(serialized.includes('spending'), false);
});

test('today never invents values before the day has samples', () => {
  assert.deepEqual(service({date: '2026-11-13', totalTokens: 0, amount: null, amountUpdatedAt: null}).today(),
    {amount: null, tokens: 0, refreshedAt: null});
});

test('today reads the live snapshot on every call instead of caching a first result', () => {
  let snapshot = {date: '2026-11-13', totalTokens: 1, amount: null, amountUpdatedAt: null};
  const subject = new CapinfoUsageService({reflect: {provide: () => () => {}}}, {snapshot: () => snapshot});
  assert.equal(subject.today().tokens, 1);
  snapshot = {date: '2026-11-13', totalTokens: 24, amount: 0.01, amountUpdatedAt: '2026-11-13T01:00:00.000Z'};
  assert.deepEqual(subject.today(), {amount: 0.01, tokens: 24, refreshedAt: '2026-11-13T01:00:00.000Z'});
});
