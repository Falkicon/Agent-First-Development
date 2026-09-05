/**
 * @fileoverview Multi-tab session synchronization
 *
 * Uses BroadcastChannel (primary) with localStorage fallback.
 * All browser APIs are guarded with typeof checks for SSR safety.
 */

export interface SessionSyncOptions {
	/** Channel name for BroadcastChannel (default: 'afd-auth-session') */
	channelName?: string;
	/** localStorage key for fallback sync (default: 'afd-auth-sync') */
	storageKey?: string;
	/** Lock key for refresh coordination (default: 'afd-auth-refresh-lock') */
	lockKey?: string;
	/** Lock timeout in ms (default: 10_000) */
	lockTimeoutMs?: number;
	/** Double-check delay for lock acquisition in ms (default: 50) */
	lockCheckDelayMs?: number;
	/** Debounce interval for state updates in ms (default: 100) */
	debounceMs?: number;
	/** Re-check session after tab hidden for this long in ms (default: 300_000 = 5 min) */
	visibilityRefreshMs?: number;
}

const DEFAULTS: Required<SessionSyncOptions> = {
	channelName: 'afd-auth-session',
	storageKey: 'afd-auth-sync',
	lockKey: 'afd-auth-refresh-lock',
	lockTimeoutMs: 10_000,
	lockCheckDelayMs: 50,
	debounceMs: 100,
	visibilityRefreshMs: 300_000,
};

interface RefreshLockRecord {
	ownerId: string;
	lockId: string;
	timestamp: number;
}

interface StorageRead<T> {
	available: boolean;
	value: T | null;
}

let ownerSequence = 0;

export class SessionSync {
	private readonly options: Required<SessionSyncOptions>;
	private channel: BroadcastChannel | null = null;
	private listeners = new Set<(data: unknown) => void>();
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private hiddenAt: number | null = null;
	private visibilityHandler: (() => void) | null = null;
	private storageHandler: ((e: StorageEvent) => void) | null = null;
	private disposed = false;
	private readonly ownerId = createOwnerId();
	private heldLockId: string | null = null;

	constructor(options: SessionSyncOptions = {}) {
		this.options = { ...DEFAULTS, ...options };
		this.init();
	}

	/**
	 * Broadcast a session change to other tabs.
	 */
	notifySessionChanged(data: unknown): void {
		if (this.disposed) return;

		if (this.channel) {
			try {
				this.channel.postMessage(data);
				return;
			} catch {
				// Fall through to localStorage
			}
		}

		this.notifyViaStorage(data);
	}

	/**
	 * Subscribe to session changes from other tabs.
	 */
	onSessionChanged(callback: (data: unknown) => void): { unsubscribe: () => void } {
		this.listeners.add(callback);
		return {
			unsubscribe: () => {
				this.listeners.delete(callback);
			},
		};
	}

	/**
	 * Attempt to acquire a refresh lock to coordinate token refresh across tabs.
	 * Returns true if lock was acquired, false if another tab holds it.
	 */
	acquireRefreshLock(): boolean {
		if (this.disposed) return false;
		if (!this.hasLocalStorage()) return true;

		const now = Date.now();
		const existing = this.readRefreshLock();
		if (!existing.available) return true;

		if (existing.value && now - existing.value.timestamp < this.options.lockTimeoutMs) {
			return false; // Another tab holds a valid lock
		}

		const lockId = createLockId();
		const lock: RefreshLockRecord = { ownerId: this.ownerId, lockId, timestamp: now };
		try {
			localStorage.setItem(this.options.lockKey, JSON.stringify(lock));
		} catch {
			// Storage can be present but denied (private browsing, blocked cookies,
			// quota). Proceed without coordination rather than failing auth refresh.
			this.heldLockId = null;
			return true;
		}

		// localStorage has no compare-and-swap. The immediate read makes the
		// synchronous fallback best-effort: if another tab won the write race,
		// this instance declines the lock. It cannot make the operation atomic.
		const observed = this.readRefreshLock();
		if (
			observed.available &&
			observed.value?.ownerId === this.ownerId &&
			observed.value.lockId === lockId
		) {
			this.heldLockId = lockId;
			return true;
		}

		this.heldLockId = null;
		return false;
	}

	/**
	 * Release the refresh lock.
	 */
	releaseRefreshLock(): void {
		const heldLockId = this.heldLockId;
		this.heldLockId = null;
		if (!this.hasLocalStorage() || heldLockId === null) return;

		const current = this.readRefreshLock();
		if (
			current.available &&
			current.value?.ownerId === this.ownerId &&
			current.value.lockId === heldLockId
		) {
			try {
				localStorage.removeItem(this.options.lockKey);
			} catch {
				// Storage became unavailable; there is nothing safe to release.
			}
		}

		// A stale owner must never retain permission to release a later owner's
		// lock through this instance.
	}

	/**
	 * Clean up all resources.
	 */
	dispose(): void {
		this.releaseRefreshLock();
		this.disposed = true;

		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		if (this.channel) {
			this.channel.close();
			this.channel = null;
		}

		if (this.storageHandler && typeof window !== 'undefined') {
			window.removeEventListener('storage', this.storageHandler);
			this.storageHandler = null;
		}

		if (this.visibilityHandler && typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', this.visibilityHandler);
			this.visibilityHandler = null;
		}

		this.listeners.clear();
	}

	private init(): void {
		// Try BroadcastChannel first
		if (typeof BroadcastChannel !== 'undefined') {
			try {
				this.channel = new BroadcastChannel(this.options.channelName);
				this.channel.onmessage = (event: MessageEvent) => {
					this.debouncedNotify(event.data);
				};
			} catch {
				// BroadcastChannel unavailable, fall through to localStorage
			}
		}

		// localStorage fallback for storage events
		if (!this.channel && this.hasLocalStorage() && typeof window !== 'undefined') {
			this.storageHandler = (e: StorageEvent) => {
				if (e.key === this.options.storageKey && e.newValue) {
					try {
						const data: unknown = JSON.parse(e.newValue);
						this.debouncedNotify(data);
					} catch {
						// Ignore malformed data
					}
				}
			};
			window.addEventListener('storage', this.storageHandler);
		}

		// Visibility change handler
		if (typeof document !== 'undefined') {
			this.visibilityHandler = () => {
				if (document.visibilityState === 'hidden') {
					this.hiddenAt = Date.now();
				} else if (document.visibilityState === 'visible' && this.hiddenAt !== null) {
					const elapsed = Date.now() - this.hiddenAt;
					this.hiddenAt = null;
					if (elapsed >= this.options.visibilityRefreshMs) {
						this.debouncedNotify({ type: 'visibility-refresh' });
					}
				}
			};
			document.addEventListener('visibilitychange', this.visibilityHandler);
		}
	}

	private notifyViaStorage(data: unknown): void {
		if (!this.hasLocalStorage()) return;
		try {
			localStorage.setItem(this.options.storageKey, JSON.stringify(data));
			// Clean up immediately — the storage event fires in other tabs
			localStorage.removeItem(this.options.storageKey);
		} catch {
			// localStorage full or unavailable
		}
	}

	private debouncedNotify(data: unknown): void {
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			for (const listener of this.listeners) {
				listener(data);
			}
		}, this.options.debounceMs);
	}

	private hasLocalStorage(): boolean {
		try {
			return typeof localStorage !== 'undefined';
		} catch {
			return false;
		}
	}

	private readRefreshLock(): StorageRead<RefreshLockRecord> {
		try {
			const raw = localStorage.getItem(this.options.lockKey);
			if (!raw) return { available: true, value: null };

			const parsed: unknown = JSON.parse(raw);
			if (isRefreshLockRecord(parsed)) return { available: true, value: parsed };

			// Read locks written by older versions so they expire normally. A
			// legacy lock has no owner and therefore cannot be released by us.
			const timestamp = Number.parseInt(raw, 10);
			return Number.isFinite(timestamp)
				? {
						available: true,
						value: { ownerId: '', lockId: '', timestamp },
					}
				: { available: true, value: null };
		} catch {
			return { available: false, value: null };
		}
	}
}

function createOwnerId(): string {
	ownerSequence += 1;
	return `afd-auth-${Date.now().toString(36)}-${ownerSequence.toString(36)}-${Math.random()
		.toString(36)
		.slice(2)}`;
}

function createLockId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isRefreshLockRecord(value: unknown): value is RefreshLockRecord {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.ownerId === 'string' &&
		typeof record.lockId === 'string' &&
		typeof record.timestamp === 'number' &&
		Number.isFinite(record.timestamp)
	);
}
