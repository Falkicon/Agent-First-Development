import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryAdapter, MemoryAdapter } from './memory-adapter.js';
import type { DataAdapter } from './types.js';

describe('MemoryAdapter', () => {
	let adapter: MemoryAdapter;

	beforeEach(() => {
		adapter = new MemoryAdapter();
	});

	describe('get', () => {
		it('returns null for non-existent record', async () => {
			expect(await adapter.get('users', 'missing')).toBeNull();
		});

		it('returns created record', async () => {
			await adapter.create('users', { id: 'u1', name: 'Alice' });
			const result = await adapter.get<{ id: string; name: string }>('users', 'u1');
			expect(result).toEqual({ id: 'u1', name: 'Alice' });
		});
	});

	describe('list', () => {
		beforeEach(async () => {
			await adapter.create('items', { id: '1', type: 'a', value: 10 });
			await adapter.create('items', { id: '2', type: 'b', value: 20 });
			await adapter.create('items', { id: '3', type: 'a', value: 30 });
		});

		it('returns all records', async () => {
			const result = await adapter.list('items');
			expect(result.total).toBe(3);
			expect(result.data).toHaveLength(3);
		});

		it('filters by param', async () => {
			const result = await adapter.list('items', { type: 'a' });
			expect(result.total).toBe(2);
		});

		it('paginates with limit/offset', async () => {
			const result = await adapter.list('items', { limit: 2, offset: 1 });
			expect(result.data).toHaveLength(2);
			expect(result.total).toBe(3); // total is pre-pagination
		});

		it('sorts ascending', async () => {
			const result = await adapter.list<{ value: number }>('items', {
				sort: 'value',
				order: 'asc',
			});
			expect(result.data[0]?.value).toBe(10);
		});

		it('sorts descending', async () => {
			const result = await adapter.list<{ value: number }>('items', {
				sort: 'value',
				order: 'desc',
			});
			expect(result.data[0]?.value).toBe(30);
		});

		it('sorts numeric values numerically in both directions', async () => {
			const db = new MemoryAdapter({
				items: [
					{ id: 'two', value: 2 },
					{ id: 'ten', value: 10 },
					{ id: 'one', value: 1 },
				],
			});

			const ascending = await db.list<{ value: number }>('items', {
				sort: 'value',
				order: 'asc',
			});
			const descending = await db.list<{ value: number }>('items', {
				sort: 'value',
				order: 'desc',
			});

			expect(ascending.data.map((row) => row.value)).toEqual([1, 2, 10]);
			expect(descending.data.map((row) => row.value)).toEqual([10, 2, 1]);
		});

		it('sorts before applying numeric pagination', async () => {
			const db = new MemoryAdapter({
				items: [
					{ id: 'two', rank: 2 },
					{ id: 'ten', rank: 10 },
					{ id: 'one', rank: 1 },
					{ id: 'twenty', rank: 20 },
				],
			});

			const result = await db.list<{ rank: number }>('items', {
				sort: 'rank',
				order: 'asc',
				offset: 1,
				limit: 2,
			});

			expect(result.data.map((row) => row.rank)).toEqual([2, 10]);
			expect(result.total).toBe(4);
		});

		it('sorts null and mixed primitive values deterministically as strings', async () => {
			const db = new MemoryAdapter({
				items: [
					{ id: 'null', value: null },
					{ id: 'bool', value: false },
					{ id: 'text', value: 'zebra' },
				],
			});

			const result = await db.list<{ id: string }>('items', { sort: 'value' });

			expect(result.data.map((row) => row.id)).toEqual(['null', 'bool', 'text']);
		});

		it('keeps equal sort values in insertion order', async () => {
			const db = new MemoryAdapter({
				items: [
					{ id: 'first', value: 1 },
					{ id: 'second', value: 1 },
				],
			});

			const result = await db.list<{ id: string }>('items', { sort: 'value' });

			expect(result.data.map((row) => row.id)).toEqual(['first', 'second']);
		});

		it('ignores undefined filters while applying defined filters', async () => {
			const result = await adapter.list('items', { type: 'a', owner: undefined });

			expect(result.total).toBe(2);
		});

		it('returns empty for non-existent table', async () => {
			const result = await adapter.list('empty');
			expect(result).toEqual({ data: [], total: 0 });
		});
	});

	describe('create', () => {
		it('creates with provided id', async () => {
			const row = await adapter.create('t', { id: 'x', name: 'test' });
			expect(row).toEqual({ id: 'x', name: 'test' });
		});

		it('auto-generates id if not provided', async () => {
			const row = await adapter.create<{ id: string; name: string }>('t', { name: 'test' });
			expect(row.id).toBeDefined();
			expect(typeof row.id).toBe('string');
		});

		it('uses name as id fallback', async () => {
			const row = await adapter.create<{ id: string; name: string }>('t', { name: 'mykey' });
			expect(row.id).toBe('mykey');
		});
	});

	describe('update', () => {
		it('merges patch into existing record', async () => {
			await adapter.create('t', { id: 'u1', name: 'old', score: 0 });
			const result = await adapter.update<{ name: string; score: number }>('t', 'u1', {
				score: 100,
			});
			expect(result).toEqual({ id: 'u1', name: 'old', score: 100 });
		});

		it('creates record if it does not exist (upsert)', async () => {
			const result = await adapter.update('t', 'new', { id: 'new', name: 'created' });
			expect(result).toEqual({ id: 'new', name: 'created' });
		});
	});

	describe('remove', () => {
		it('removes existing record', async () => {
			await adapter.create('t', { id: 'r1' });
			await adapter.remove('t', 'r1');
			expect(await adapter.get('t', 'r1')).toBeNull();
		});

		it('no-ops for non-existent record', async () => {
			await adapter.remove('t', 'missing'); // should not throw
		});
	});

	describe('batch', () => {
		it('executes multiple operations', async () => {
			const result = await adapter.batch([
				{ method: 'POST', path: '/users', body: { id: 'u1', name: 'A' } },
				{ method: 'POST', path: '/users', body: { id: 'u2', name: 'B' } },
				{ method: 'GET', path: '/users/u1' },
			]);
			expect(result.summary.total).toBe(3);
			expect(result.summary.success).toBe(3);
			expect(result.summary.failed).toBe(0);
		});

		it('handles DELETE in batch', async () => {
			await adapter.create('items', { id: 'd1' });
			const result = await adapter.batch([{ method: 'DELETE', path: '/items/d1' }]);
			expect(result.summary.success).toBe(1);
			expect(await adapter.get('items', 'd1')).toBeNull();
		});

		it('returns list and missing-record responses for GET operations', async () => {
			await adapter.create('items', { id: 'one' });

			const result = await adapter.batch([
				{ method: 'GET', path: '/items' },
				{ method: 'GET', path: '/items/missing' },
			]);

			expect(result.results).toEqual([
				{ status: 200, data: { data: [{ id: 'one' }], total: 1 } },
				{ status: 404, data: null },
			]);
			expect(result.summary).toEqual({ total: 2, success: 2, failed: 0 });
		});

		it.each(['PUT', 'PATCH'] as const)('updates records with %s operations', async (method) => {
			const result = await adapter.batch([{ method, path: '/items/one', body: { value: method } }]);

			expect(result.results[0]).toEqual({
				status: 200,
				data: { id: 'one', value: method },
			});
		});

		it('reports unsupported methods without aborting later operations', async () => {
			const result = await adapter.batch([
				{ method: 'OPTIONS' as 'GET', path: '/items' },
				{ method: 'POST', path: '/items', body: { id: 'one' } },
			]);

			expect(result.results[0]).toEqual({ status: 400, error: 'Unknown method: OPTIONS' });
			expect(result.summary).toEqual({ total: 2, success: 1, failed: 1 });
		});

		it('isolates thrown operation errors and continues the batch', async () => {
			class FailingAdapter extends MemoryAdapter {
				override async create<T>(table: string, data: Partial<T>): Promise<T> {
					if (table === 'broken') throw 'write failed';
					return super.create(table, data);
				}
			}
			const db = new FailingAdapter();

			const result = await db.batch([
				{ method: 'POST', path: '/broken', body: {} },
				{ method: 'POST', path: '/items', body: { id: 'one' } },
			]);

			expect(result.results[0]).toEqual({ status: 500, error: 'write failed' });
			expect(result.summary).toEqual({ total: 2, success: 1, failed: 1 });
		});

		it('preserves Error messages when an operation throws an Error object', async () => {
			class FailingAdapter extends MemoryAdapter {
				override async remove(): Promise<void> {
					throw new Error('delete failed');
				}
			}

			const result = await new FailingAdapter().batch([{ method: 'DELETE', path: '/items/one' }]);

			expect(result.results[0]).toEqual({ status: 500, error: 'delete failed' });
		});
	});

	describe('health', () => {
		it('returns ok status', async () => {
			const h = await adapter.health();
			expect(h.status).toBe('ok');
			expect(h.tables).toBe(0);
		});
	});

	describe('utility methods', () => {
		it('clear removes all data', async () => {
			await adapter.create('a', { id: '1' });
			await adapter.create('b', { id: '1' });
			adapter.clear();
			expect(adapter.count('a')).toBe(0);
		});

		it('count returns table size', async () => {
			await adapter.create('t', { id: '1' });
			await adapter.create('t', { id: '2' });
			expect(adapter.count('t')).toBe(2);
		});
	});

	describe('initialData', () => {
		it('populates tables from constructor', async () => {
			const db = new MemoryAdapter({
				users: [
					{ id: 'u1', name: 'Alice' },
					{ id: 'u2', name: 'Bob' },
				],
			});
			const result = await db.list('users');
			expect(result.total).toBe(2);
		});
	});
});

describe('createMemoryAdapter', () => {
	it('returns a MemoryAdapter instance', () => {
		const adapter = createMemoryAdapter();
		expect(adapter).toBeInstanceOf(MemoryAdapter);
	});

	it('satisfies DataAdapter interface', async () => {
		const adapter: DataAdapter = createMemoryAdapter();
		expect(typeof adapter.get).toBe('function');
		expect(typeof adapter.list).toBe('function');
		expect(typeof adapter.create).toBe('function');
		expect(typeof adapter.update).toBe('function');
		expect(typeof adapter.remove).toBe('function');
		expect(typeof adapter.batch).toBe('function');
		expect(typeof adapter.health).toBe('function');
	});
});
