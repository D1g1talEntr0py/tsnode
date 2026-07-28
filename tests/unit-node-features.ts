import { describe, expect, test } from 'vitest';
import {
	cliTestFlag,
	esmLoadReadFile,
	importAttributes,
	importMetaPathProperties,
	isFeatureSupported,
	isFeatureSupportedInRange,
	modulePackageMainResolution,
	moduleRegister,
	nativeTypeScript,
	testRunnerGlob,
	wasmModules,
	type Version,
} from '../src/utils/node-features';

const version = (major: number, minor: number, patch: number): Version => [major, minor, patch];

describe('node feature helpers', () => {
	describe('isFeatureSupported', () => {
		test.each([
			{
				name: 'supports the first major when the current version is on the same major',
				versions: [version(18, 1, 0), version(20, 6, 0)],
				current: version(18, 2, 0),
				expected: true,
			},
			{
				name: 'requires the last listed version when the major does not match an earlier entry',
				versions: [version(18, 1, 0), version(20, 6, 0)],
				current: version(19, 0, 0),
				expected: false,
			},
			{
				name: 'accepts the last version boundary exactly',
				versions: [version(18, 1, 0), version(20, 6, 0)],
				current: version(20, 6, 0),
				expected: true,
			},
			{
				name: 'rejects a lower patch on the supported major',
				versions: [version(20, 19, 0), version(22, 12, 0), version(23, 0, 0)],
				current: version(20, 18, 9),
				expected: false,
			},
		])('$name', ({ versions, current, expected }) => {
			expect(isFeatureSupported(versions, current)).toBe(expected);
		});
	});

	describe('isFeatureSupportedInRange', () => {
		const sampleRanges = [
			{ from: version(20, 11, 0), before: version(21, 0, 0) },
			{ from: version(21, 3, 0) },
		];

		test.each([
			{
				name: 'supports inclusive lower bounds and exclusive upper bounds',
				ranges: sampleRanges,
				current: version(20, 11, 0),
				expected: true,
			},
			{
				name: 'rejects the upper bound of a bounded range',
				ranges: sampleRanges,
				current: version(21, 0, 0),
				expected: false,
			},
			{
				name: 'accepts the second bounded range when the current version lands inside it',
				ranges: sampleRanges,
				current: version(21, 3, 0),
				expected: true,
			},
			{
				name: 'rejects versions below every range',
				ranges: sampleRanges,
				current: version(20, 10, 9),
				expected: false,
			},
		])('$name', ({ ranges, current, expected }) => {
			expect(isFeatureSupportedInRange(ranges, current)).toBe(expected);
		});
	});

	describe('feature matrix exports', () => {
		test.each([
			['moduleRegister', moduleRegister, version(20, 6, 0), true],
			['importAttributes', importAttributes, version(20, 10, 0), true],
			['testRunnerGlob', testRunnerGlob, version(21, 0, 0), true],
			['cliTestFlag', cliTestFlag, version(18, 1, 0), true],
			['esmLoadReadFile', esmLoadReadFile, version(21, 3, 0), true],
			['importMetaPathProperties', importMetaPathProperties, version(21, 2, 0), true],
			['nativeTypeScript', nativeTypeScript, version(23, 6, 0), true],
			['wasmModules', wasmModules, version(24, 5, 0), true],
			['modulePackageMainResolution', modulePackageMainResolution, version(19, 0, 0), true],
		])('%s', (_name, versions, current, expected) => {
			expect(isFeatureSupported(versions, current)).toBe(expected);
		});

		test('evaluates range-based exports with the range helper', () => {
			expect(isFeatureSupportedInRange(
				[{ from: version(24, 0, 0), before: version(24, 1, 0) }],
				version(24, 0, 5),
			)).toBe(true);
		});
	});
});