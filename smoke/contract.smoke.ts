// Holds lib/schema.ts against the core's OpenAPI spec (openapi.yaml), the
// contract of the public API: what the SDK sends must be what the broker
// takes, and what the broker answers must be what the SDK reads.
//
// LOGWOLF_OPENAPI names the spec file: the one a core release publishes, or
// openapi.yaml in a core checkout.

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import z from 'zod';

import {
	CreateLogwolfEventDTOSchema,
	DeleteLogwolfEventDTOSchema,
	LogwolfEventSchema,
	MAX_PAGE,
	MAX_PAGE_SIZE,
} from '../lib/schema';
import { dereference, fits, type Schema } from './json-schema';

const specPath = process.env.LOGWOLF_OPENAPI;
if (!specPath) throw new Error('Set LOGWOLF_OPENAPI to the path of the core’s openapi.yaml');
const spec = parse(readFileSync(specPath, 'utf8'));

function component(kind: string, name: string): Schema {
	const found = spec.components?.[kind]?.[name];
	if (found === undefined) throw new Error(`The spec has no components.${kind}.${name}`);
	return dereference(found, spec);
}

/** The schema of a query parameter. */
function parameter(name: string): Schema {
	return component('parameters', name).schema as Schema;
}

/** The wire format of a zod schema: before decoding, after encoding. */
function wire(schema: z.ZodType): Schema {
	return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Schema;
}

/** The JSON schema of an operation's request body. */
function requestBody(path: string, method: string): Schema {
	const body = spec.paths?.[path]?.[method]?.requestBody?.content?.['application/json']?.schema;
	if (body === undefined) throw new Error(`The spec has no JSON body for ${method.toUpperCase()} ${path}`);
	return dereference(body, spec);
}

// Fields of an event the SDK reads and leaves out on purpose, with why.
const UNREAD_EVENT_FIELDS = {
	// Every event a key reads belongs to that key's project.
	project_id: '$.project_id',
};

describe('lib/schema.ts against the OpenAPI spec', () => {
	it.each([
		['post', '/logs'],
		['post', '/logs/batch'],
		['get', '/logs'],
		['get', '/logs/{id}'],
		['delete', '/logs'],
	])('the SDK’s %s %s is in the spec', (method, path) => {
		expect(spec.paths?.[path]?.[method]).toBeDefined();
	});

	it('sends events the broker takes', () => {
		expect(fits(wire(CreateLogwolfEventDTOSchema), component('schemas', 'NewEvent'))).toEqual([]);
	});

	it('sends a batch the broker takes', () => {
		const batch = requestBody('/logs/batch', 'post');
		expect(fits(wire(z.array(CreateLogwolfEventDTOSchema)), batch)).toEqual([]);
	});

	it('sends a delete the broker takes', () => {
		expect(fits(wire(DeleteLogwolfEventDTOSchema), requestBody('/logs', 'delete'))).toEqual([]);
	});

	it('reads every event the broker answers, and every field of it', () => {
		const problems = fits(component('schemas', 'Event'), wire(LogwolfEventSchema), {
			ignore: Object.values(UNREAD_EVENT_FIELDS),
		});
		expect(problems).toEqual([]);
	});

	it('has the broker’s pagination bounds', () => {
		expect(MAX_PAGE_SIZE).toBe(parameter('PageSize').maximum);
		expect(MAX_PAGE).toBe(parameter('Page').maximum);
	});
});
