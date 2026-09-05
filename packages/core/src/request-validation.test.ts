import { describe, expect, it, vi } from 'vitest';
import type { PipelineRequest } from './pipeline.js';
import { executePipeline } from './pipeline-executor.js';
import { isBatchRequest, isPipelineRequest } from './request-validation.js';

const malformedSteps = [
	null,
	[],
	{},
	{ command: '' },
	{ command: 42 },
	{ command: 'write', input: [] },
	{ command: 'write', when: { $eq: null } },
	{ command: 'write', when: { $and: [null] } },
	{ command: 'write', when: { $not: null } },
	{ command: 'write', stream: 'false' },
];
describe('execution envelope preflight', () => {
	it.each(malformedSteps)(
		'rejects invalid later pipeline steps before any handler: %j',
		async (step) => {
			const request = { steps: [{ command: 'write' }, step] };
			expect(isPipelineRequest(request)).toBe(false);
			const execute = vi.fn();
			const result = await executePipeline(request as PipelineRequest, execute);
			expect(execute).not.toHaveBeenCalled();
			expect(result.steps[0]?.error).toMatchObject({
				code: 'INVALID_PIPELINE_REQUEST',
				suggestion: expect.any(String),
			});
		}
	);
	it.each([
		null,
		[],
		'bad',
		{ timeoutMs: -1 },
		{ timeoutMs: NaN },
		{ timeoutMs: Infinity },
		{ continueOnFailure: 'true' },
		{ parallel: 1 },
		{ onProgress: true },
	])('rejects invalid pipeline options %j', async (options) => {
		const execute = vi.fn();
		await executePipeline({ steps: [{ command: 'write' }], options } as PipelineRequest, execute);
		expect(execute).not.toHaveBeenCalled();
	});
	it.each([null, {}, [], { command: '' }, { command: 'write', id: 1 }])(
		'rejects malformed later batch commands %j',
		(command) => {
			expect(isBatchRequest({ commands: [{ command: 'write' }, command] })).toBe(false);
		}
	);
	it.each([
		null,
		[],
		false,
		{ stopOnError: 'false' },
		{ parallelism: 1.5 },
		{ parallelism: Infinity },
		{ timeout: NaN },
	])('rejects malformed batch options %j', (options) => {
		expect(isBatchRequest({ commands: [{ command: 'write' }], options })).toBe(false);
	});
	it('rejects sparse step arrays and cyclic conditions', () => {
		expect(isPipelineRequest({ steps: new Array(1) })).toBe(false);
		expect(isBatchRequest({ commands: new Array(1) })).toBe(false);
		const cyclic: Record<string, unknown> = {};
		cyclic.$not = cyclic;
		expect(isPipelineRequest({ steps: [{ command: 'write', when: cyclic }] })).toBe(false);
	});
	it('rejects excessively nested conditions before command execution', async () => {
		let when: Record<string, unknown> = { $exists: '$input' };
		for (let depth = 0; depth < 200; depth++) when = { $not: when };
		const execute = vi.fn();
		const result = await executePipeline(
			{ steps: [{ command: 'write' }, { command: 'read', when }] } as PipelineRequest,
			execute
		);
		expect(execute).not.toHaveBeenCalled();
		expect(result.steps[0]?.error?.code).toBe('INVALID_PIPELINE_REQUEST');
	});
});
