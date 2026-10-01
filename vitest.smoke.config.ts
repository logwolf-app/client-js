import { defineConfig } from 'vitest/config';

// The suites that need the core: its OpenAPI spec, and a running stack. See
// "Smoke test" in docs/OVERVIEW.md.
export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		projects: [
			{
				extends: true,
				test: { name: 'contract', include: ['smoke/contract.smoke.ts'] },
			},
			{
				extends: true,
				test: {
					name: 'smoke',
					include: ['smoke/sdk.smoke.ts'],
					globalSetup: ['smoke/setup.ts'],
					testTimeout: 60_000,
					hookTimeout: 240_000,
				},
			},
		],
	},
});
