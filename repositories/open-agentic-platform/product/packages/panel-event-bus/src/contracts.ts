import type { PanelEventContract, EventTypeName } from './types.js';

/**
 * Panel contract enforcement utilities (FR-003).
 *
 * Contracts declare which events a panel can emit and subscribe to.
 * The EventBus enforces these at runtime; these helpers assist with
 * defining, merging, and validating contracts outside the bus.
 */

/** Create a PanelEventContract with validation. */
export function defineContract(
  panelType: string,
  emits: EventTypeName[],
  subscribes: EventTypeName[],
): PanelEventContract {
  if (!panelType) throw new Error('panelType must be non-empty');
  return { panelType, emits: [...emits], subscribes: [...subscribes] };
}

/** Merge two contracts for the same panel type. */
export function mergeContracts(a: PanelEventContract, b: PanelEventContract): PanelEventContract {
  if (a.panelType !== b.panelType) {
    throw new Error(`Cannot merge contracts for different panel types: "${a.panelType}" and "${b.panelType}"`);
  }
  const emits = [...new Set([...a.emits, ...b.emits])];
  const subscribes = [...new Set([...a.subscribes, ...b.subscribes])];
  return { panelType: a.panelType, emits, subscribes };
}

/** Validate that a contract only references known event types. */
export function validateContract(
  contract: PanelEventContract,
  registeredTypes: Set<EventTypeName>,
): string[] {
  const errors: string[] = [];
  for (const e of contract.emits) {
    if (!registeredTypes.has(e)) {
      errors.push(`Emit "${e}" references unregistered event type`);
    }
  }
  for (const s of contract.subscribes) {
    // Skip wildcard patterns — they match dynamically
    if (s.includes('*')) continue;
    if (!registeredTypes.has(s)) {
      errors.push(`Subscribe "${s}" references unregistered event type`);
    }
  }
  return errors;
}
