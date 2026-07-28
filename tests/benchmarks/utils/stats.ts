export const mean = (values: number[]) => {
	if (values.length === 0) { throw new Error('Cannot calculate mean of empty array') }
	return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const standardDeviation = (values: number[]) => {
	const valuesMean = mean(values);
	return Math.sqrt(mean(values.map(value => (value - valuesMean) ** 2)));
};

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
