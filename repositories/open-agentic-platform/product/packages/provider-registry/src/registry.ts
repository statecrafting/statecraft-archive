import type {
  Provider,
  ProviderCapabilities,
  ProviderId,
  ProviderRegistry,
} from "./types.js";

/**
 * In-memory provider registry (spec 042 Phase 1). Safe for concurrent async use on
 * the JS single-threaded event loop: Map operations are synchronous between awaits.
 */
export class InMemoryProviderRegistry implements ProviderRegistry {
  private readonly providers = new Map<ProviderId, Provider>();

  register(provider: Provider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(
        `Provider "${provider.id}" is already registered; duplicate ids are not allowed (FR-005).`,
      );
    }
    this.providers.set(provider.id, provider);
  }

  get(id: ProviderId): Provider {
    const p = this.providers.get(id);
    if (!p) {
      throw new Error(`Provider "${id}" is not registered`);
    }
    return p;
  }

  has(id: ProviderId): boolean {
    return this.providers.has(id);
  }

  list(): Array<{ id: ProviderId; capabilities: ProviderCapabilities }> {
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      capabilities: p.capabilities,
    }));
  }

  unregister(id: ProviderId): boolean {
    return this.providers.delete(id);
  }
}

let singleton: InMemoryProviderRegistry | null = null;

/** Lazily constructed singleton (FR-001). */
export function getProviderRegistry(): ProviderRegistry {
  if (!singleton) {
    singleton = new InMemoryProviderRegistry();
  }
  return singleton;
}

/** Test-only: reset singleton. */
export function resetProviderRegistryForTests(): void {
  singleton = null;
}
