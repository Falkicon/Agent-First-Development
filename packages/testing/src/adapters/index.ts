/**
 * Adapters Module
 *
 * App-specific adapters for the JTBD testing framework.
 */

// Types
export type {
  AdapterContext,
  AdapterRegistry,
  AdapterRegistryOptions,
  AppAdapter,
  AppliedCommand,
  ApplyFixtureResult,
  CliConfig,
  CommandHandler,
  CommandsConfig,
  ErrorsConfig,
  FixtureApplicator,
  FixtureConfig,
  FixtureResetter,
  FixtureValidationResult,
  FixtureValidator,
  JobsConfig,
} from './types.js';

// Registry
export {
  createAdapterRegistry,
  detectAdapter,
  getAdapter,
  getGlobalRegistry,
  listAdapters,
  registerAdapter,
  resetGlobalRegistry,
  setGlobalRegistry,
} from './registry.js';

// Generic adapter
export {
  createGenericAdapter,
  genericAdapter,
  type GenericAdapterOptions,
} from './generic.js';

// Todo adapter
export {
  createTodoAdapter,
  todoAdapter,
  type TodoFixture,
  type TodoSeed,
} from './todo.js';
