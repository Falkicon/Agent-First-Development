/**
 * @fileoverview React hooks for AFD auth
 *
 * Sub-path export: import from '@lushly-dev/afd-auth/react'
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { AuthAdapter, AuthSessionState, User } from './types.js';
import { LOADING } from './types.js';

export type { ConvexAuthAdapterOptions } from './adapters/convex.js';
export { useConvexAuthAdapter } from './adapters/convex.js';

export interface AuthHooks {
	useAuth: () => AuthAdapter;
	useSession: () => AuthSessionState;
	useUser: () => User | null;
}

/**
 * Providers are allowed to return a new object from getSession() on every
 * read. React's external-store contract requires the snapshot itself to be
 * cached, so compare the session's semantic values before replacing it.
 */
function areSessionStatesEqual(a: AuthSessionState, b: AuthSessionState): boolean {
	if (a.status !== b.status) return false;
	if (a.status !== 'authenticated' || b.status !== 'authenticated') return true;

	const aExpiresAt = a.session.expiresAt;
	const bExpiresAt = b.session.expiresAt;
	const expiresAtEqual =
		aExpiresAt instanceof Date && bExpiresAt instanceof Date
			? Object.is(aExpiresAt.getTime(), bExpiresAt.getTime())
			: Object.is(aExpiresAt, bExpiresAt);

	return (
		a.session.id === b.session.id &&
		expiresAtEqual &&
		a.user.id === b.user.id &&
		a.user.email === b.user.email &&
		a.user.name === b.user.name &&
		a.user.image === b.user.image
	);
}

/**
 * Create React hooks bound to an auth adapter instance.
 */
export function createAuthHooks(adapter: AuthAdapter): AuthHooks {
	let cachedSnapshot: AuthSessionState | undefined;
	const readSnapshot = (): AuthSessionState => {
		const nextSnapshot = adapter.getSession();
		if (cachedSnapshot && areSessionStatesEqual(cachedSnapshot, nextSnapshot)) {
			return cachedSnapshot;
		}
		cachedSnapshot = nextSnapshot;
		return nextSnapshot;
	};

	function useAuth(): AuthAdapter {
		return adapter;
	}

	function useSession(): AuthSessionState {
		const subscribe = useCallback((onStoreChange: () => void) => {
			const { unsubscribe } = adapter.onAuthStateChange(() => {
				onStoreChange();
			});
			return unsubscribe;
		}, []);

		// Read the adapter at snapshot time. useSyncExternalStore checks this
		// value again immediately after subscribing, which closes the render to
		// subscription race where an auth event arrives between those phases.
		const getSnapshot = useCallback(readSnapshot, []);
		const getServerSnapshot = useCallback(() => LOADING, []);

		return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
	}

	function useUser(): User | null {
		const session = useSession();
		return session.status === 'authenticated' ? session.user : null;
	}

	return { useAuth, useSession, useUser };
}
