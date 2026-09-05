import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClient } from './client.js';

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response: ServerResponse, value: unknown): void {
	response.writeHead(200, { 'Content-Type': 'application/json' });
	response.end(JSON.stringify(value));
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('McpClient HTTP integration', () => {
	it('executes afd-batch with partial results and streams POST input through callbacks', async () => {
		const toolNames: string[] = [];
		const streamBodies: unknown[] = [];
		const server = createServer(async (request, response) => {
			if (request.method === 'GET' && request.url === '/health') {
				sendJson(response, { status: 'ok' });
				return;
			}
			if (request.method === 'POST' && request.url === '/stream/items-stream') {
				streamBodies.push(await readJson(request));
				response.writeHead(200, { 'Content-Type': 'text/event-stream' });
				response.write('data: {"type":"data","data":{"id":1},"index":0}\n\n');
				response.end(
					'data: {"type":"complete","data":{"count":1},"totalChunks":1,"durationMs":2}\n\n'
				);
				return;
			}
			if (request.method !== 'POST' || request.url !== '/message') {
				response.writeHead(404).end();
				return;
			}

			const rpc = await readJson(request);
			const id = rpc.id;
			if (rpc.method === 'initialize') {
				sendJson(response, {
					jsonrpc: '2.0',
					id,
					result: {
						protocolVersion: '2024-11-05',
						serverInfo: { name: 'integration', version: '1.0.0' },
						capabilities: {},
					},
				});
				return;
			}
			if (rpc.method === 'tools/list') {
				sendJson(response, { jsonrpc: '2.0', id, result: { tools: [] } });
				return;
			}

			const params = rpc.params as { name: string };
			toolNames.push(params.name);
			const batch = {
				success: true,
				results: [
					{
						id: 'cmd-0',
						index: 0,
						command: 'item-get',
						result: { success: true, data: { id: 1 } },
						durationMs: 1,
					},
					{
						id: 'cmd-1',
						index: 1,
						command: 'item-get',
						result: {
							success: false,
							error: { code: 'NOT_FOUND', message: 'Missing item', suggestion: 'Use id 1' },
						},
						durationMs: 1,
					},
				],
				summary: { total: 2, successCount: 1, failureCount: 1, skippedCount: 0 },
				timing: { startedAt: '', completedAt: '', totalMs: 2, averageMs: 1 },
				confidence: 0.5,
				reasoning: 'One of two commands succeeded',
			};
			sendJson(response, {
				jsonrpc: '2.0',
				id,
				result: { content: [{ type: 'text', text: JSON.stringify(batch) }] },
			});
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const address = server.address();
		if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
		const client = new McpClient({
			url: `http://127.0.0.1:${address.port}/message`,
			transport: 'http',
		});

		try {
			await client.connect();
			const batch = await client.batch([
				{ command: 'item-get', input: { id: 1 } },
				{ command: 'item-get', input: { id: 2 } },
			]);
			const data = vi.fn();
			const complete = vi.fn();
			await client.streamWithCallbacks(
				'items-stream',
				{ count: 2 },
				{ onData: data, onComplete: complete }
			);

			expect(toolNames).toEqual(['afd-batch']);
			expect(batch.summary).toEqual({
				total: 2,
				successCount: 1,
				failureCount: 1,
				skippedCount: 0,
			});
			expect(batch.results[1]?.result.error?.suggestion).toBe('Use id 1');
			expect(streamBodies).toEqual([{ count: 2 }]);
			expect(data).toHaveBeenCalledOnce();
			expect(complete).toHaveBeenCalledOnce();
		} finally {
			await client.disconnect();
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		}
	});
});
