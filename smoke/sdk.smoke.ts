// Sends events through the SDK to a real Logwolf stack and reads them back:
// one at a time, in a batch, by page and by id, and deletes them. smoke/setup.ts
// readies the stack and hands over a key with every scope.

import { inject } from 'vitest';

import { Logwolf } from '../lib/client';
import { LogwolfEvent } from '../lib/event';
import { MAX_PAGE, MAX_PAGE_SIZE, type LogwolfConfig, type LogwolfEventData, type Severity } from '../lib/schema';

const brokerUrl = inject('brokerUrl');
const apiKey = inject('apiKey');

const config = {
	url: brokerUrl,
	apiKey,
	flushIntervalMs: 60_000,
	maxBatchSize: 100,
	maxQueueSize: 100,
	retryDelaysMs: [500, 1000],
	requestTimeoutMs: 10_000,
} satisfies LogwolfConfig;

// Events are stored asynchronously, a moment after the broker queues them.
const STORED_WITHIN_MS = 30_000;

async function readBack(client: Logwolf, names: string[]): Promise<LogwolfEventData[]> {
	const deadline = Date.now() + STORED_WITHIN_MS;
	for (;;) {
		const page = await client.getAll({ page: 1, pageSize: MAX_PAGE_SIZE });
		const found = names.map((name) => page.find((e) => e.name === name));
		if (found.every((e) => e !== undefined)) return found as LogwolfEventData[];
		if (Date.now() > deadline) {
			const missing = names.filter((_, i) => found[i] === undefined);
			throw new Error(`Not stored within ${STORED_WITHIN_MS / 1000}s: ${missing.join(', ')}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}

describe('the SDK against a running Logwolf', () => {
	const run = Date.now().toString(36);
	let client: Logwolf;

	beforeEach(() => {
		client = new Logwolf(config);
	});

	afterEach(() => {
		client.destroy();
	});

	it('sends one event and reads it back, by page and by id', async () => {
		const event = new LogwolfEvent({ name: `single-${run}`, severity: 'warning', tags: ['smoke', 'single'] });
		event.set('run', run);
		event.set('nested', { ok: true, n: 1 });
		await client.create(event);

		const [stored] = await readBack(client, [`single-${run}`]);
		expect(stored).toMatchObject({
			name: `single-${run}`,
			severity: 'warning',
			tags: ['smoke', 'single'],
			data: { run, nested: { ok: true, n: 1 } },
		});
		expect(stored!.created_at).toBeInstanceOf(Date);

		await expect(client.getOne(stored!.id)).resolves.toEqual(stored);
	});

	it('sends a batch and reads every event back', async () => {
		const onDropped = vi.fn<NonNullable<LogwolfConfig['onDropped']>>();
		client = new Logwolf({ ...config, onDropped });

		const severities: Severity[] = ['info', 'warning', 'error', 'critical'];
		for (const severity of severities) {
			const event = new LogwolfEvent({ name: `batch-${severity}-${run}`, severity, tags: ['smoke', 'batch'] });
			event.set('severity', severity);
			expect(client.capture(event)).toBe(true);
		}
		await client.flush();
		expect(onDropped).not.toHaveBeenCalled();

		const stored = await readBack(
			client,
			severities.map((s) => `batch-${s}-${run}`),
		);
		expect(stored.map((e) => e.severity)).toEqual(severities);
		expect(stored.map((e) => e.data)).toEqual(severities.map((severity) => ({ severity })));
	});

	it('deletes events', async () => {
		const name = `delete-${run}`;
		await client.create(new LogwolfEvent({ name, severity: 'info', tags: [] }));
		const [stored] = await readBack(client, [name]);

		await client.delete({ id: stored!.id });

		await expect(client.getOne(stored!.id)).resolves.toBeUndefined();
		const page = await client.getAll({ page: 1, pageSize: MAX_PAGE_SIZE });
		expect(page.map((e) => e.id)).not.toContain(stored!.id);
	});

	it('serves the largest page and the deepest the SDK allows', async () => {
		await expect(client.getAll({ page: 1, pageSize: MAX_PAGE_SIZE })).resolves.toBeInstanceOf(Array);
		await expect(client.getAll({ page: MAX_PAGE, pageSize: 1 })).resolves.toEqual([]);
	});

	it.each([
		{ page: '1', pageSize: String(MAX_PAGE_SIZE + 1) },
		{ page: String(MAX_PAGE + 1), pageSize: '1' },
	])('refuses a page past the SDK’s bounds: %o', async (params) => {
		// The SDK refuses these itself, so ask the broker directly.
		const url = new URL('logs?' + new URLSearchParams(params), brokerUrl);
		const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
		expect(res.status).toBe(400);
	});
});
