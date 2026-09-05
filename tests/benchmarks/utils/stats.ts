export const mean = (values: number[]) => {
	if (values.length === 0) { throw new Error('Cannot calculate mean of empty array') }
	return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const standardDeviation = (values: number[]) => {
	const valuesMean = mean(values);
	return Math.sqrt(mean(values.map(value => (value - valuesMean) ** 2)));
};

/**
 * Nearest-rank percentile (e.g. p90/p95) for tail-latency reporting.
 * @param values Sample values (need not be pre-sorted).
 * @param p Percentile in [0, 100].
 */
export const percentile = (values: number[], p: number) => {
	if (values.length === 0) { throw new Error('Cannot calculate percentile of empty array') }
	if (p < 0 || p > 100) { throw new Error(`Invalid percentile: ${p}`) }

	const sorted = values.slice().sort((a, b) => a - b);
	const rank = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
};

export const median = (values: number[]) => percentile(values, 50);

/**
 * Least-squares linear fit of y = slope*x + intercept.
 * For --scale: slope ≈ per-module cost, intercept ≈ fixed startup tax.
 * @param points Array of {x, y} points to fit.
 * @returns Object with slope and intercept of the best-fit line.
 */
export const linearFit = (points: { x: number; y: number; }[]) => {
	const n = points.length;
	const sumX = points.reduce((sum, point) => sum + point.x, 0);
	const sumY = points.reduce((sum, point) => sum + point.y, 0);
	const sumXy = points.reduce((sum, point) => sum + (point.x * point.y), 0);
	const sumXx = points.reduce((sum, point) => sum + (point.x * point.x), 0);
	const slope = ((n * sumXy) - (sumX * sumY)) / ((n * sumXx) - (sumX * sumX));
	const intercept = (sumY - (slope * sumX)) / n;

	return { slope, intercept };
};
