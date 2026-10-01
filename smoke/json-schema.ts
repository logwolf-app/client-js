// Just enough JSON Schema to compare the SDK's wire format, as zod describes
// it, with the core's OpenAPI spec: types, enums, objects and arrays. Bounds,
// formats and patterns are left out.

export type Schema = {
	$ref?: string;
	type?: string | string[];
	enum?: unknown[];
	const?: unknown;
	anyOf?: Schema[];
	properties?: Record<string, Schema>;
	required?: string[];
	items?: Schema;
	[key: string]: unknown;
};

/** Resolves every local `$ref` in `schema` against `root`, keeping the siblings of each. */
export function dereference(schema: Schema, root: unknown): Schema {
	if (Array.isArray(schema)) return schema.map((s) => dereference(s, root)) as unknown as Schema;
	if (typeof schema !== 'object' || schema === null) return schema;

	const { $ref, ...rest } = schema;
	const resolved: Schema = {};
	if ($ref !== undefined) {
		if (!$ref.startsWith('#/')) throw new Error(`Only local $refs are supported: ${$ref}`);
		const target = $ref
			.slice(2)
			.split('/')
			.reduce<any>((node, key) => node?.[key], root);
		if (target === undefined) throw new Error(`Unresolved $ref: ${$ref}`);
		Object.assign(resolved, dereference(target, root));
	}
	for (const [key, value] of Object.entries(rest)) {
		resolved[key] = typeof value === 'object' && value !== null ? dereference(value as Schema, root) : value;
	}
	return resolved;
}

function jsonType(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
	return typeof value;
}

type Shape = {
	types: Set<string> | null; // null: any type
	values: unknown[] | null; // null: any value of those types
	properties: Record<string, Schema>;
	required: Set<string>;
	items: Schema | undefined;
};

/** Flattens a schema, `anyOf` branches included, into what the comparison needs. */
function shape(schema: Schema): Shape {
	if (schema.anyOf) {
		const branches = schema.anyOf.map(shape);
		const anyType = branches.some((b) => b.types === null);
		const anyValue = branches.some((b) => b.values === null);
		return {
			types: anyType ? null : new Set(branches.flatMap((b) => [...b.types!])),
			values: anyValue ? null : branches.flatMap((b) => b.values!),
			properties: Object.assign({}, ...branches.map((b) => b.properties)),
			required: new Set(branches.flatMap((b) => [...b.required])),
			items: branches.find((b) => b.items)?.items,
		};
	}

	let values: unknown[] | null = null;
	if (schema.const !== undefined) values = [schema.const];
	else if (schema.enum) values = schema.enum;

	let types: Set<string> | null = null;
	if (schema.type !== undefined) types = new Set([schema.type].flat());
	else if (values) types = new Set(values.map(jsonType));

	return {
		types,
		values,
		properties: schema.properties ?? {},
		required: new Set(schema.required ?? []),
		items: schema.items,
	};
}

function covers(types: Set<string> | null, type: string): boolean {
	return types === null || types.has(type) || (type === 'integer' && types.has('number'));
}

export type FitOptions = {
	/** Properties the sender has and the receiver leaves out on purpose, by path. */
	ignore?: string[];
};

/**
 * Lists every way a value `sent` describes could fall outside what `accepted`
 * describes: a type or value the receiver doesn't take, a property it doesn't
 * know, or one it requires that the sender may leave out. Empty when it fits.
 */
export function fits(sent: Schema, accepted: Schema, options: FitOptions = {}, path = '$'): string[] {
	const s = shape(sent);
	const a = shape(accepted);
	const problems: string[] = [];

	if (s.types === null) {
		if (a.types !== null) problems.push(`${path}: may be any type, but only ${[...a.types].join(' | ')} is taken`);
	} else {
		for (const type of s.types) {
			if (!covers(a.types, type)) problems.push(`${path}: may be ${type}, which is not taken`);
		}
	}

	if (a.values !== null) {
		if (s.values === null) {
			problems.push(`${path}: may be any value, but only ${JSON.stringify(a.values)} are taken`);
		} else {
			for (const value of s.values) {
				if (!a.values.includes(value)) problems.push(`${path}: may be ${JSON.stringify(value)}, which is not taken`);
			}
		}
	}

	if (s.types?.has('object')) {
		for (const [key, schema] of Object.entries(s.properties)) {
			const at = `${path}.${key}`;
			if (options.ignore?.includes(at)) continue;
			const other = a.properties[key];
			if (other === undefined) problems.push(`${at}: is sent, but not known to the receiver`);
			else problems.push(...fits(schema, other, options, at));
		}
		for (const key of a.required) {
			if (!s.required.has(key)) problems.push(`${path}.${key}: is required, but may be left out`);
		}
	}

	if (s.types?.has('array') && s.items && a.items) {
		problems.push(...fits(s.items, a.items, options, `${path}[]`));
	}

	return problems;
}
