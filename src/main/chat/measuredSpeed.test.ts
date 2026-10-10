import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateWasTooOptimistic, measuredSpeedTier } from '../../shared/utils/measuredSpeed';

test('measured speeds read as Fast, OK or Slow, matching what a real test showed', () => {
  // From a real test on one machine: models that fit in GPU memory vs ones that spilled onto the CPU.
  assert.equal(measuredSpeedTier(136.6), 'Fast');
  assert.equal(measuredSpeedTier(74.2), 'Fast');
  assert.equal(measuredSpeedTier(30), 'Fast');
  assert.equal(measuredSpeedTier(12.8), 'OK');
  assert.equal(measuredSpeedTier(8), 'OK');
  assert.equal(measuredSpeedTier(7.9), 'Slow');
  assert.equal(measuredSpeedTier(3.2), 'Slow');
  assert.equal(measuredSpeedTier(2.1), 'Slow');
});

test('only an estimate better than the measurement is flagged', () => {
  assert.equal(estimateWasTooOptimistic('OK', 'Slow'), true, 'the Command R case: estimated OK, measured 2.1 tok/s');
  assert.equal(estimateWasTooOptimistic('Fast', 'OK'), true);
  assert.equal(estimateWasTooOptimistic('Fast', 'Slow'), true);
  assert.equal(estimateWasTooOptimistic('OK', 'OK'), false);
  assert.equal(estimateWasTooOptimistic('Slow', 'Fast'), false, 'faster than estimated is just good news');
  assert.equal(estimateWasTooOptimistic('Unknown', 'Slow'), false, 'an estimate that is not a tier is never flagged');
});
