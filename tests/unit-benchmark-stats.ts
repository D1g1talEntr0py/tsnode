import { describe, expect, test } from 'vitest';
import { mean, median, percentile, standardDeviation } from './benchmarks/utils/stats';

describe('benchmark stats helpers', () => {
	test('mean averages values', () => {
		expect(mean([1, 2, 3, 4])).toBe(2.5);
	});

	test('mean throws on empty array', () => {
		expect(() => mean([])).toThrow();
	});

	test('percentile returns exact value for p0/p100', () => {
		const values = [5, 3, 1, 4, 2];
		expect(percentile(values, 0)).toBe(1);
		expect(percentile(values, 100)).toBe(5);
	});

	test('percentile does not require pre-sorted input', () => {
		expect(percentile([30, 10, 20], 50)).toBe(20);
	});

	test('percentile validates its range', () => {
		expect(() => percentile([1], -1)).toThrow();
		expect(() => percentile([1], 101)).toThrow();
	});

	test('percentile throws on empty array', () => {
		expect(() => percentile([], 90)).toThrow();
	});

	test('median matches p50', () => {
		expect(median([1, 2, 3, 4, 5])).toBe(3);
		expect(median([1, 2, 3, 4])).toBe(percentile([1, 2, 3, 4], 50));
	});

	test('standardDeviation is zero for identical values', () => {
		expect(standardDeviation([7, 7, 7])).toBe(0);
	});

	test('standardDeviation is positive for varied values', () => {
		expect(standardDeviation([1, 2, 3, 4, 5])).toBeGreaterThan(0);
	});
});
