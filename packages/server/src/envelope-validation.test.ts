import { type BatchRequest, type PipelineRequest, success } from '@lushly-dev/afd-core';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createExecutionEngine } from './execution.js';
import { defineCommand } from './schema.js';

describe('request preflight before side effects', () => {
	it.each([
		null,
		{},
		{ commands: [{ command: 'write-item', input: {} }, null] },
		{ commands: [{ command: 'write-item', input: {} }], options: null },
		{ commands: [{ command: 'write-item', input: {} }], options: { stopOnError: 'false' } },
	])('rejects malformed batch %j without writes', async (request) => {
		const handler = vi.fn(async () => success({ written: true }));
		const command = defineCommand({
			name: 'write-item',
			description: 'Write an item',
			input: z.object({}),
			handler,
		});
		const engine = createExecutionEngine({
			commandMap: new Map([[command.name, command]]),
			middleware: [],
			devMode: false,
		});
		const result = await engine.executeBatch(request as BatchRequest);
		expect(result.error).toMatchObject({
			code: 'INVALID_BATCH_REQUEST',
			suggestion: expect.any(String),
		});
		expect(handler).not.toHaveBeenCalled();
	});
	it('rejects malformed later pipeline conditions before writes', async () => {
		const handler = vi.fn(async () => success({ written: true }));
		const command = defineCommand({
			name: 'write-item',
			description: 'Write an item',
			input: z.object({}),
			handler,
		});
		const engine = createExecutionEngine({
			commandMap: new Map([[command.name, command]]),
			middleware: [],
			devMode: false,
		});
		const result = await engine.executePipeline({
			steps: [{ command: 'write-item' }, { command: 'write-item', when: { $eq: null } }],
		} as unknown as PipelineRequest);
		expect(result.steps[0]?.error?.code).toBe('INVALID_PIPELINE_REQUEST');
		expect(handler).not.toHaveBeenCalled();
	});
});
