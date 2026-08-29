export const waitFor = async (
	condition: () => boolean,
	{ timeout = 30_000, interval = 20 } = {},
) => {
	const deadline = Date.now() + timeout;

	while (!condition()) {
		if (Date.now() >= deadline) {
			throw new Error('Timed out waiting for condition');
		}

		await new Promise<void>((resolve) => setTimeout(resolve, interval));
	}
};