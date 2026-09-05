# @lushly-dev/afd-auth

Provider-agnostic authentication adapters for AFD applications. The main
entrypoint exposes the `AuthAdapter` contract, structured auth errors,
multi-tab session synchronization, and the Mock and Better Auth adapters.

Auth command definitions are available from the optional commands subpath:

```ts
import { createAuthCommands } from '@lushly-dev/afd-auth/commands';

const authCommands = createAuthCommands(adapter);
```

React hooks are available from the optional `@lushly-dev/afd-auth/react`
subpath:

```ts
import { createAuthHooks, useConvexAuthAdapter } from '@lushly-dev/afd-auth/react';

const { useSession, useUser } = createAuthHooks(adapter);
```

The root import stays usable for server and non-React consumers without
installing React, `@lushly-dev/afd-server`, or `zod`. Import
`useConvexAuthAdapter` from `/react` and `createAuthCommands` from `/commands`
when those integrations are needed.

`SessionSync.acquireRefreshLock()` and `releaseRefreshLock()` provide a
synchronous best-effort fallback for coordinating refreshes between tabs. The
fallback records an instance owner and only that owner can release its current
lock. `localStorage` does not provide compare-and-swap, so acquisition remains
non-atomic under a simultaneous cross-tab race; applications that require
stronger serialization should use a provider-level refresh mechanism.
