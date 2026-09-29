/**
 * Reuse google.maps.Map instances across React remounts.
 * Each `new google.maps.Map()` is a billable Dynamic Maps load — caching
 * the instance + its div avoids paying again for Strict Mode, tab switches,
 * and short-lived picker maps that share the same Map ID.
 */

import type { MapInstance } from "./provider";

const stacks = new Map<string, MapInstance[]>();

function keyFor(mapId: string): string {
  return mapId.trim() || "default";
}

export function popCachedMap(mapId: string): MapInstance | null {
  const stack = stacks.get(keyFor(mapId));
  if (!stack || stack.length === 0) return null;
  return stack.pop() ?? null;
}

export function pushCachedMap(mapId: string, map: MapInstance): void {
  const key = keyFor(mapId);
  const stack = stacks.get(key) ?? [];
  stack.push(map);
  stacks.set(key, stack);
}

/** True when the Map's hosting div is still a usable DOM node. */
export function isReusableMap(map: MapInstance): boolean {
  try {
    const div = map.getDiv();
    return div instanceof HTMLElement;
  } catch {
    return false;
  }
}
