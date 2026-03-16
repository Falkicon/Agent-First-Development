import { createServer, type Server as HttpServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './schema.js';
import { createMcpHandler } from './server.js';

const echoCommand = defineCommand({
	name: 'test-echo',
	description: 'Echo input text',
	category: 'test',
	version: '1.0.0',
	input: z.object({
		message: z.string(),
	}),
	handler: async (input) => ({
		success: true,
		data: { echo: input.message },
	}),
});

async function startHandlerServer(port: number): Promise<{ server: HttpServer; baseUrl: string }> {
	const handler = createMcpHandler({
		name: 'test-handler',
		version: '1.0.0',
		commands: [echoCommand],
		host: '127.0.0.1',
		port,
	});

	const server = createServer((req, res) => {
		void handler(req, res);
	});

	await new Promise<void>((resolve, reject) => {
		server.on('error', reject);
		server.listen(port, '127.0.0.1', () => resolve());
	});

	return {
		server,
		baseUrl: `http://127.0.0.1:${port}`,
	};
}

describe('createMcpHandler', () => {
	let server: HttpServer | null = null;

	afterEach(async () => {
		if (!server) return;
		await new Promise<void>((resolve, reject) => {
			server?.close((error) => {
				if (error) reject(error);
				else resolve();
			});
		});
		server = null;
	});

	it('responds to /health without using createMcpServer', async () => {
		const started = await startHandlerServer(3310);
		server = started.server;

		const response = await fetch(`${started.baseUrl}/health`);
		const body = (await response.json()) as {
			status: string;
			name: string;
			version: string;
		};

		expect(response.status).toBe(200);
		expect(body).toEqual({
			status: 'ok',
			name: 'test-handler',
			version: '1.0.0',
		});
	});

	it('executes commands via /rpc', async () => {
		const started = await startHandlerServer(3311);
		server = started.server;

		const response = await fetch(`${started.baseUrl}/rpc`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				method: 'test-echo',
				params: { message: 'hello' },
				id: 'rpc-1',
			}),
		});

		const body = (await response.json()) as {
			jsonrpc: string;
			id: string;
			result: { success: boolean; data: { echo: string } };
		};

		expect(response.status).toBe(200);
		expect(body.jsonrpc).toBe('2.0');
		expect(body.id).toBe('rpc-1');
		expect(body.result.success).toBe(true);
		expect(body.result.data).toEqual({ echo: 'hello' });
	});

	it('executes batch requests via /batch', async () => {
		const started = await startHandlerServer(3312);
		server = started.server;

		const response = await fetch(`${started.baseUrl}/batch`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				commands: [{ command: 'test-echo', input: { message: 'batch' } }],
			}),
		});

		const body = (await response.json()) as {
			success: boolean;
			results: Array<{
				id: string;
				command: string;
				result: {
					success: boolean;
					data: { echo: string };
				};
			}>;
		};

		expect(response.status).toBe(200);
		expect(body.success).toBe(true);
		expect(body.results).toHaveLength(1);
		expect(body.results[0]).toMatchObject({
			id: 'cmd-0',
			command: 'test-echo',
			result: {
				success: true,
				data: { echo: 'batch' },
			},
		});
	});
});
