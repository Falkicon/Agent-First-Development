import type { McpClient } from '@lushly-dev/afd-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	config: {
		serverUrl: 'http://saved.example/mcp',
		transport: 'sse' as const,
		timeout: 4321,
		autoReconnect: false,
	},
	createClient: vi.fn(),
}));

vi.mock('@lushly-dev/afd-client', () => ({ createClient: mocks.createClient }));
vi.mock('./config.js', () => ({ getConfig: () => mocks.config }));

import { ensureConnected, getClient, setClient } from './connection.js';

function makeClient() {
	return {
		connect: vi.fn().mockResolvedValue({}),
		disconnect: vi.fn().mockResolvedValue(undefined),
		getStatus: vi.fn().mockReturnValue({ url: 'http://saved.example/mcp' }),
		isConnected: vi.fn().mockReturnValue(false),
	} as unknown as McpClient;
}

describe('ensureConnected', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setClient(null);
	});

	it('recreates a connection with all persisted settings', async () => {
		const client = makeClient();
		mocks.createClient.mockReturnValue(client);

		expect(await ensureConnected()).toBe(client);
		expect(mocks.createClient).toHaveBeenCalledWith({
			url: 'http://saved.example/mcp',
			transport: 'sse',
			timeout: 4321,
			autoReconnect: false,
		});
		expect(getClient()).toBe(client);
	});

	it('uses an explicit per-command URL without changing stored configuration', async () => {
		const client = makeClient();
		mocks.createClient.mockReturnValue(client);

		await ensureConnected({ url: 'http://scenario.example/mcp', transport: 'http', timeout: 99 });

		expect(mocks.createClient).toHaveBeenCalledWith({
			url: 'http://scenario.example/mcp',
			transport: 'http',
			timeout: 99,
			autoReconnect: false,
		});
		expect(mocks.config.serverUrl).toBe('http://saved.example/mcp');
	});

	it('returns null and closes a client that cannot connect', async () => {
		const client = makeClient();
		vi.mocked(client.connect).mockRejectedValue(new Error('offline'));
		mocks.createClient.mockReturnValue(client);

		expect(await ensureConnected()).toBeNull();
		expect(client.disconnect).toHaveBeenCalled();
	});
});
