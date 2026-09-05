/** @fileoverview Installed CLI package version. */

import { createRequire } from 'node:module';

const packageJson = createRequire(import.meta.url)('../package.json') as { version: string };

export const CLI_VERSION = packageJson.version;
