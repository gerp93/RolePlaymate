import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActiveTimeClock, CHAT_IDLE_MS } from '../../shared/utils/activeTimeClock';
import { formatClock } from '../../shared/utils/formatDuration';

test('the clock counts while there is recent input', () => {
  const clock = new ActiveTimeClock(0);
  assert.equal(clock.tick(1000, true), 1000);
  assert.equal(clock.tick(2000, true), 1000);
});

test('it keeps counting through the idle window, then pauses', () => {
  const clock = new ActiveTimeClock(0, 5000);
  let total = 0;
  for (let t = 1000; t <= 10000; t += 1000) total += clock.tick(t, true);
  // Input at 0; counts up to the 5s idle limit (ticks at 1..4s), nothing after.
  assert.equal(total, 4000);
  assert.equal(clock.isActive(10000), false);
});

test('input after a pause resumes counting', () => {
  const clock = new ActiveTimeClock(0, 5000);
  for (let t = 1000; t <= 20000; t += 1000) clock.tick(t, true);
  clock.noteActivity(20500);
  assert.equal(clock.tick(21000, true), 1000);
  assert.equal(clock.tick(22000, true), 1000);
});

test('a hidden window does not count, even with recent input', () => {
  const clock = new ActiveTimeClock(0);
  assert.equal(clock.tick(1000, false), 0);
  assert.equal(clock.tick(2000, true), 1000);
});

test('a long gap between ticks (sleep, stalled timer) is not credited in full', () => {
  const clock = new ActiveTimeClock(0);
  clock.tick(1000, true);
  clock.noteActivity(60 * 60 * 1000);
  assert.equal(clock.tick(60 * 60 * 1000, true), 2000);
});

test('the default idle window is two minutes', () => {
  assert.equal(CHAT_IDLE_MS, 120000);
});

test('formatClock reads as m:ss, then h:mm:ss', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(7), '0:07');
  assert.equal(formatClock(307), '5:07');
  assert.equal(formatClock(3907), '1:05:07');
  assert.equal(formatClock(-3), '0:00');
});
