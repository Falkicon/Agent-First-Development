import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DirectClient } from './direct.js';
import {
	clearProtocolHandlers,
	createReconnectingHandoff,
	type HandoffConnectionOptions,
	registerProtocolHandler,
} from './handoff.js';

describe('handoff connection ownership', () => {
	afterEach(() => {
		clearProtocolHandlers();
		vi.useRealTimers();
	});
	it('closes manual replacements and ignores obsolete connection callbacks', async () => {
		vi.useFakeTimers();
		const attempts: Array<{
			options: HandoffConnectionOptions;
			send: ReturnType<typeof vi.fn>;
			close: ReturnType<typeof vi.fn>;
		}> = [];
		registerProtocolHandler('websocket', async (handoff, options) => {
			const send = vi.fn(),
				close = vi.fn(() => options.onDisconnect?.());
			attempts.push({ options, send, close });
			options.onConnect?.({});
			return {
				send,
				close,
				state: 'connected',
				protocol: handoff.protocol,
				endpoint: handoff.endpoint,
			};
		});
		const messages = vi.fn(),
			errors = vi.fn();
		const connection = await createReconnectingHandoff(
			{} as DirectClient,
			{ protocol: 'websocket', endpoint: 'wss://example.com/socket' },
			{ backoffMs: 0, maxBackoffMs: 0, onMessage: messages, onError: errors }
		);
		const previous = attempts[0];
		if (!previous) throw new Error('Missing initial attempt');
		const reconnecting = connection.reconnect();
		expect(previous.close).toHaveBeenCalledOnce();
		await vi.runAllTimersAsync();
		await reconnecting;
		const replacement = attempts[1];
		if (!replacement) throw new Error('Missing replacement');
		previous.options.onDisconnect?.();
		previous.options.onConnect?.({});
		previous.options.onMessage?.('stale');
		previous.options.onError?.(new Error('stale'));
		expect(connection.state).toBe('connected');
		connection.send('latest');
		expect(replacement.send).toHaveBeenCalledExactlyOnceWith('latest');
		expect(messages).not.toHaveBeenCalled();
		expect(errors).not.toHaveBeenCalled();
		expect(attempts).toHaveLength(2);
		connection.close();
		expect(replacement.close).toHaveBeenCalledOnce();
		replacement.options.onConnect?.({});
		expect(connection.state).toBe('disconnected');
	});
});
