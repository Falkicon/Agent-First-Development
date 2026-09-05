import type { McpClient } from '@lushly-dev/afd-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	ensureConnected: vi.fn(),
	getClient: vi.fn().mockReturnValue(null),
	setClient: vi.fn(),
}));

vi.mock('../connection.js', () => mocks);

import { createCli } from '../cli.js';

describe('afd call invocation', () => {
	afterEach(() => vi.restoreAllMocks());

	it('parses the runner contract and calls an explicit HTTP server', async () => {
		const call = vi.fn().mockResolvedValue({ success: true, data: { id: 'created' } });
		mocks.ensureConnected.mockResolvedValue({ call } as unknown as McpClient);
		vi.spyOn(console, 'log').mockImplementation(() => undefined);

		await createCli().parseAsync(
			[
				'call',
				'todo-create',
				'{"title":"From scenario"}',
				'--connect',
				'http://localhost:3100/mcp',
				'--transport',
				'http',
				'--format',
				'json',
			],
			{ from: 'user' }
		);

		expect(mocks.ensureConnected).toHaveBeenCalledWith({
			url: 'http://localhost:3100/mcp',
			transport: 'http',
			timeout: undefined,
		});
		expect(call).toHaveBeenCalledWith('todo-create', { title: 'From scenario' });
	});
});
