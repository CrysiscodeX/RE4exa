// The engine provider registry (internal; COD exposes providers through operations later). Each
// provider caches its own discovery for the life of the process. LLVM is the first provider.
import type { EngineProvider } from "./contract.ts";
import { llvmProvider } from "./llvm.ts";

const MAX_PROVIDERS = 64;
const registered = new Map<string, EngineProvider>();

/** Add a provider; an id may be registered once. */
export function registerProvider(p: EngineProvider): void {
  if (registered.has(p.id)) throw new Error(`engine provider ${p.id} is already registered`);
  if (registered.size >= MAX_PROVIDERS) throw new Error(`at most ${MAX_PROVIDERS} engine providers`);
  registered.set(p.id, p);
}

/** Every registered provider, in registration order. */
export function providers(): EngineProvider[] {
  return [...registered.values()];
}

/** The provider with this id, if registered. */
export function provider(id: string): EngineProvider | undefined {
  return registered.get(id);
}

registerProvider(llvmProvider() as EngineProvider);
