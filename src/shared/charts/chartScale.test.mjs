import test from 'node:test';
import assert from 'node:assert/strict';
import { compactChartValue, createChartScale } from './chartScale.mjs';

test('Auto selects Log at the exact 100× boundary, including values outside Number precision', () => {
  const minimum = '9007199254740993';
  assert.equal(createChartScale([minimum, '900719925474099299']).effective, 'linear');
  assert.equal(createChartScale([minimum, '900719925474099300']).effective, 'log');
  assert.equal(createChartScale(['0.0000000000000001', '0.00000000000001']).effective, 'log');
});

test('zero and negative observations remain real values and refuse Log without clamping', () => {
  for (const values of [['0', '100'], ['-20', '100'], ['0']]) {
    const scale = createChartScale(values, { mode: 'log' });
    assert.equal(scale.effective, 'linear');
    assert.equal(scale.logAvailable, false);
    assert.ok(values.every((value) => Number.isFinite(scale.position(value))));
  }
});

test('missing or invalid evidence cannot become a zero observation', () => {
  const scale = createChartScale(['', 'NaN', 'Infinity', '1/2', '1']);
  assert.equal(scale.invalidCount, 4);
  assert.equal(scale.minimum, '1');
  assert.equal(scale.maximum, '1');
  for (const value of ['', 'NaN', 'Infinity', '1/2']) assert.equal(scale.position(value), null);
  const empty = createChartScale(['']);
  assert.deepEqual(empty.ticks, []);
  assert.equal(empty.minimum, null);
  assert.equal(empty.position('0'), null);
});

test('one-atom changes in huge supplies survive normalization with legible distinct axis labels', () => {
  const first = '9999999999999999999999999999999999999999999999';
  const last = '10000000000000000000000000000000000000000000000';
  const scale = createChartScale([first, last], { mode: 'linear' });
  assert.equal(scale.position(first), 0);
  assert.equal(scale.position(last), 1);
  assert.equal(scale.axisOffset, first);
  assert.deepEqual(scale.ticks.map(({ axisValue }) => axisValue), ['0', '0.5', '1']);
  const labels = scale.ticks.map(({ value, axisValue }) => compactChartValue(axisValue ?? value));
  assert.equal(new Set(labels).size, scale.ticks.length);
});

test('Q16 subatoms and decimal precision remain distinct', () => {
  const scale = createChartScale(['0.0000000000000001', '0.0000000000000002'], { mode: 'linear' });
  assert.equal(scale.position('0.0000000000000001'), 0);
  assert.equal(scale.position('0.00000000000000015'), 0.5);
  assert.equal(scale.position('0.0000000000000002'), 1);
  assert.equal(scale.minimum, '0.0000000000000001');
});

test('Log coordinates support decimal magnitudes beyond Number range', () => {
  const scale = createChartScale(['1e-400', '1e400'], { mode: 'log' });
  assert.equal(scale.effective, 'log');
  assert.equal(scale.position('1e-400'), 0);
  assert.equal(scale.position('1'), 0.5);
  assert.equal(scale.position('1e400'), 1);
});

test('constant observations have a visible finite domain, without mutating source input', () => {
  const values = Object.freeze(['123', '123']);
  const scale = createChartScale(values);
  assert.ok(scale.ticks.length >= 2);
  assert.ok(scale.position('123') > 0 && scale.position('123') < 1);
  assert.deepEqual(values, ['123', '123']);
});

test('compact labels are display-only and retain small values', () => {
  assert.equal(compactChartValue('0.0000000000000001'), '1e-16');
  assert.equal(compactChartValue('1000000000'), '1B');
  assert.equal(compactChartValue('-1250000'), '−1.25M');
  assert.equal(compactChartValue('0'), '0');
  assert.equal(compactChartValue('not a value'), 'Unavailable');
});
