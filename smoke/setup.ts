// Readies a running Logwolf stack for the smoke test: waits until the broker
// is healthy, then creates a project and a key with every scope on the
// dashboard's internal routes, which is why the test talks to the broker
// directly and not through Caddy.
//
// LOGWOLF_SMOKE_URL is the broker's address (http://localhost:8080 by
// default), and LOGWOLF_SMOKE_INTERNAL_SECRET its INTERNAL_API_SECRET.

import type { TestProject } from 'vitest/node';

declare module 'vitest' {
	export interface ProvidedContext {
		brokerUrl: string;
		apiKey: string;
	}
}

const HEALTH_TIMEOUT_MS = 180_000;

async function waitForHealth(brokerUrl: string): Promise<void> {
	const deadline = Date.now() + HEALTH_TIMEOUT_MS;
	let last = 'no answer';
	while (Date.now() < deadline) {
		try {
			const res = await fetch(new URL('health', brokerUrl));
			if (res.ok) return;
			last = `${res.status} ${await res.text()}`;
		} catch (err) {
			last = String(err);
		}
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}
	throw new Error(`The broker at ${brokerUrl} was not healthy within ${HEALTH_TIMEOUT_MS / 1000}s: ${last}`);
}

async function internal<T>(brokerUrl: string, secret: string, path: string, body: unknown): Promise<T> {
	const res = await fetch(new URL(path, brokerUrl), {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Internal-Secret': secret,
			'X-User-Login': 'sdk-smoke-test',
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
	return ((await res.json()) as { data: T }).data;
}

export default async function setup(project: TestProject) {
	const url = process.env.LOGWOLF_SMOKE_URL ?? 'http://localhost:8080';
	const brokerUrl = url.endsWith('/') ? url : url + '/';
	const secret = process.env.LOGWOLF_SMOKE_INTERNAL_SECRET;
	if (!secret) throw new Error('Set LOGWOLF_SMOKE_INTERNAL_SECRET to the broker’s INTERNAL_API_SECRET');

	await waitForHealth(brokerUrl);

	// A project of its own on every run, so the test reads its own events alone.
	const { id } = await internal<{ id: string }>(brokerUrl, secret, 'projects', {
		name: 'SDK smoke test',
		slug: 'sdk-smoke-test',
	});
	const { key } = await internal<{ key: string }>(brokerUrl, secret, `projects/${id}/keys`, {
		scopes: ['ingest', 'read', 'delete'],
	});

	project.provide('brokerUrl', brokerUrl);
	project.provide('apiKey', key);
}
