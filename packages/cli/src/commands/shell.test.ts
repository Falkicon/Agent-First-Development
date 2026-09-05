import type { McpClient } from '@lushly-dev/afd-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	const readline = {
		prompt: vi.fn(),
		setPrompt: vi.fn(),
		on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
			handlers.set(event, handler);
			return readline;
		}),
	};
	return {
		handlers,
		readline,
		currentClient: null as McpClient | null,
		createClient: vi.fn(),
		setConfig: vi.fn(),
	};
});

vi.mock('node:readline', () => ({ createInterface: () => mocks.readline }));
vi.mock('@lushly-dev/afd-client', () => ({ createClient: mocks.createClient }));
vi.mock('../config.js', () => ({
	getConfig: () => ({}),
	setConfig: mocks.setConfig,
	deleteConfig: vi.fn(),
}));
vi.mock('../connection.js', () => ({
	getClient: () => mocks.currentClient,
	setClient: (client: McpClient | null) => {
		mocks.currentClient = client;
	},
	ensureConnected: vi.fn(),
}));

import { createCli } from '../cli.js';

function connectedClient(): McpClient {
	return {
		connect: vi.fn().mockResolvedValue({ serverInfo: { name: 'shell', version: '1' } }),
		disconnect: vi.fn().mockResolvedValue(undefined),
		isConnected: vi.fn().mockReturnValue(true),
		getStatus: vi.fn().mockReturnValue({
			state: 'connected',
			url: 'http://shell/mcp',
			serverInfo: { name: 'shell', version: '1' },
		}),
		getTools: vi.fn().mockReturnValue([]),
		refreshTools: vi.fn().mockResolvedValue([
			{ name: 'todo.create', description: 'Create todo', inputSchema: { type: 'object' } },
			{ name: 'user.get', inputSchema: { type: 'object' } },
		]),
		call: vi.fn().mockResolvedValue({ success: true, data: { id: '1' } }),
	} as unknown as McpClient;
}

async function line(value: string): Promise<void> {
	const handler = mocks.handlers.get('line');
	if (!handler) throw new Error('line handler was not registered');
	await handler(value);
}

describe('interactive shell', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.handlers.clear();
		mocks.currentClient = null;
		vi.spyOn(console, 'log').mockImplementation(() => undefined);
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.spyOn(console, 'clear').mockImplementation(() => undefined);
		vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
	});

	afterEach(() => vi.restoreAllMocks());

	it('drives connection, discovery, calls, status, and disconnect from readline input', async () => {
		const client = connectedClient();
		mocks.createClient.mockReturnValue(client);

		await createCli().exitOverride().parseAsync(['shell'], { from: 'user' });
		await line('');
		await line('help');
		await line('unknown');
		await line('status');
		await line('connect');
		await line('connect http://shell/mcp');
		await line('status');
		await line('tools todo');
		await line('call todo.create {"title":"Test"}');
		await line('todo.create count=2 label=hello');
		await line('clear');
		await line('disconnect');
		await line('disconnect');
		await line('tools');
		await line('call');

		expect(client.connect).toHaveBeenCalled();
		expect(client.refreshTools).toHaveBeenCalled();
		expect(client.call).toHaveBeenNthCalledWith(1, 'todo.create', { title: 'Test' });
		expect(client.call).toHaveBeenNthCalledWith(2, 'todo.create', {
			count: 2,
			label: 'hello',
		});
		expect(client.disconnect).toHaveBeenCalled();
		expect(console.clear).toHaveBeenCalled();
		expect(mocks.readline.setPrompt).toHaveBeenCalled();
	});

	it('handles auto-connect, invalid input, failures, and exit aliases', async () => {
		const client = connectedClient();
		(client.call as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('call failed'));
		mocks.createClient.mockReturnValue(client);

		await createCli()
			.exitOverride()
			.parseAsync(['shell', '--url', 'http://auto/mcp'], { from: 'user' });
		await line('call todo.create {broken');
		await line('call todo.create {}');
		await line('?');
		await line('list');
		await line('q');

		expect(mocks.setConfig).toHaveBeenCalledWith('serverUrl', 'http://auto/mcp');
		expect(console.error).toHaveBeenCalledWith(
			expect.anything(),
			'Invalid arguments. Use JSON or key=value format.'
		);
		expect(process.exit).toHaveBeenCalledWith(0);
	});

	it('keeps the shell available when connection attempts fail', async () => {
		const failed = connectedClient();
		(failed.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('offline'));
		mocks.createClient.mockReturnValue(failed);

		await createCli()
			.exitOverride()
			.parseAsync(['shell', '--url', 'http://offline/mcp'], { from: 'user' });
		await line('connect http://offline/mcp');

		expect(console.error).toHaveBeenCalledWith(expect.anything(), 'Auto-connect failed');
		expect(console.error).toHaveBeenCalledWith(expect.anything(), 'Connection failed');
		expect(mocks.readline.prompt).toHaveBeenCalled();
	});
});
