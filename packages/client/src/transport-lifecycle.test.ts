import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sources = vi.hoisted(
	() =>
		[] as Array<{
			onopen?: () => void;
			onmessage?: (event: { data: string }) => void;
			onerror?: () => void;
			readyState: number;
			close: ReturnType<typeof vi.fn>;
			options: { fetch?: typeof fetch };
		}>
);
vi.mock('eventsource', () => ({
	EventSource: class {
		static OPEN = 1;
		readyState = 1;
		close = vi.fn(() => {
			this.readyState = 2;
		});
		constructor(
			_url: string,
			readonly options: { fetch?: typeof fetch }
		) {
			sources.push(this);
		}
	},
}));

import { HttpTransport, SseTransport } from './transport.js';

const request = { jsonrpc: '2.0' as const, id: 1, method: 'tools/list' };
const response = { jsonrpc: '2.0', id: 1, result: { tools: [] } };

function sourceAt(index: number) {
	const source = sources[index];
	if (!source) throw new Error('Missing test source');
	return source;
}

describe('SSE connection lifecycle', () => {
	beforeEach(() => {
		sources.length = 0;
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});
	it('rejects already canceled handshakes without opening a socket', async () => {
		const transport = new SseTransport('http://localhost/sse');
		await expect(transport.connect(AbortSignal.abort(new Error('canceled')))).rejects.toThrow(
			'canceled'
		);
		expect(sources).toHaveLength(0);
	});
	it.each(['abort', 'disconnect'] as const)(
		'closes pending handshakes on %s and ignores late open events',
		async (action) => {
			const transport = new SseTransport('http://localhost/sse');
			const controller = new AbortController();
			const connecting = transport.connect(controller.signal);
			const rejected = expect(connecting).rejects.toThrow();
			const source = sourceAt(0);
			if (action === 'abort') controller.abort();
			else transport.disconnect();
			await rejected;
			source.onopen?.();
			expect(source.close).toHaveBeenCalledOnce();
			expect(transport.isConnected()).toBe(false);
		}
	);
	it('terminates failed handshakes and does not revive on EventSource retry', async () => {
		const transport = new SseTransport('http://localhost/sse');
		const errors = vi.fn();
		transport.onError(errors);
		const connecting = transport.connect();
		const rejected = expect(connecting).rejects.toThrow('SSE connection error');
		const source = sourceAt(0);
		source.onerror?.();
		await rejected;
		source.onopen?.();
		source.onerror?.();
		expect(source.close).toHaveBeenCalledOnce();
		expect(errors).toHaveBeenCalledOnce();
		expect(transport.isConnected()).toBe(false);
	});
	it('dispatches responses, reports malformed JSON, and closes lost connections once', async () => {
		const transport = new SseTransport('http://localhost/sse');
		const messages = vi.fn(),
			errors = vi.fn(),
			close = vi.fn();
		transport.onMessage(messages);
		transport.onError(errors);
		transport.onClose(close);
		const connecting = transport.connect();
		const source = sourceAt(0);
		source.onopen?.();
		await connecting;
		expect(transport.isConnected()).toBe(true);
		source.onmessage?.({ data: JSON.stringify(response) });
		source.onmessage?.({ data: JSON.stringify({ unrelated: true }) });
		source.onmessage?.({ data: 'broken JSON' });
		expect(messages).toHaveBeenCalledExactlyOnceWith(response);
		expect(errors).toHaveBeenCalledOnce();
		source.onerror?.();
		source.onerror?.();
		expect(close).toHaveBeenCalledOnce();
		expect(source.close).toHaveBeenCalledOnce();
		expect(transport.isConnected()).toBe(false);
	});
	it('merges auth headers with EventSource fetch headers and preserves cancellation', async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response());
		vi.stubGlobal('fetch', fetchMock);
		const transport = new SseTransport('http://localhost/sse', { Authorization: 'Bearer test' });
		const connecting = transport.connect();
		const source = sourceAt(0);
		const controller = new AbortController();
		await source.options.fetch?.('http://localhost/sse', {
			headers: { Accept: 'text/event-stream' },
			signal: controller.signal,
		});
		const init = fetchMock.mock.calls[0]?.[1];
		expect(init.headers).toEqual({ accept: 'text/event-stream', Authorization: 'Bearer test' });
		controller.abort();
		expect(init.signal.aborted).toBe(true);
		await source.options.fetch?.('http://localhost/sse');
		source.onopen?.();
		await connecting;
		transport.disconnect();
	});
	it('ignores old source events after connection replacement', async () => {
		const transport = new SseTransport('http://localhost/sse');
		const message = vi.fn();
		transport.onMessage(message);
		const first = transport.connect();
		const old = sourceAt(0);
		old.onopen?.();
		await first;
		const second = transport.connect();
		const latest = sourceAt(1);
		latest.onopen?.();
		await second;
		old.onerror?.();
		old.onmessage?.({ data: JSON.stringify(response) });
		expect(transport.isConnected()).toBe(true);
		expect(message).not.toHaveBeenCalled();
		transport.disconnect();
	});
	it('handles messages and loss when callbacks are absent', async () => {
		const transport = new SseTransport('http://localhost/sse');
		const connecting = transport.connect();
		const source = sourceAt(0);
		source.onopen?.();
		await connecting;
		source.onmessage?.({ data: JSON.stringify(response) });
		source.onmessage?.({ data: '{' });
		source.onerror?.();
		expect(transport.isConnected()).toBe(false);
	});
});

describe.each([SseTransport, HttpTransport])('%s request boundary', (TransportClass) => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});
	it('posts JSON and custom headers to the message endpoint', async () => {
		const fetchMock = vi.fn().mockResolvedValue(Response.json(response));
		vi.stubGlobal('fetch', fetchMock);
		const transport = new TransportClass('http://localhost/sse', { Authorization: 'Bearer test' });
		expect(await transport.send(request)).toEqual(response);
		expect(fetchMock).toHaveBeenCalledWith(
			'http://localhost/message',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify(request),
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
			})
		);
	});
	it.each([
		Response.json({ bad: true }),
		new Response('', { status: 503, statusText: 'Unavailable' }),
	])('rejects malformed or failed HTTP replies', async (reply) => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply.clone()));
		await expect(new TransportClass('http://localhost/sse').send(request)).rejects.toThrow();
	});
	it.each(['caller', 'disconnect'] as const)('cancels in-flight posts on %s', async (action) => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_url, init) =>
					new Promise((_resolve, reject) => {
						init.signal.addEventListener('abort', () => reject(init.signal.reason));
					})
			)
		);
		const transport = new TransportClass('http://localhost/sse');
		const controller = new AbortController();
		const pending = transport.send(request, controller.signal);
		const rejected = expect(pending).rejects.toThrow();
		if (action === 'caller') controller.abort(new Error('canceled'));
		else transport.disconnect();
		await rejected;
	});
});
