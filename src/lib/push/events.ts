/**
 * In-app foreground push events (FCM onMessage → existing banner UI).
 */

export type ForegroundPushEvent = {
  id: string;
  title: string;
  body: string;
  link: string | null;
  type: string;
  receivedAt: number;
};

type Listener = (event: ForegroundPushEvent) => void;

const listeners = new Set<Listener>();

let seq = 0;

export function emitForegroundPush(
  partial: Omit<ForegroundPushEvent, "id" | "receivedAt"> & { id?: string }
): ForegroundPushEvent {
  const event: ForegroundPushEvent = {
    id: partial.id ?? `fg-${Date.now()}-${++seq}`,
    title: partial.title,
    body: partial.body,
    link: partial.link,
    type: partial.type || "general",
    receivedAt: Date.now(),
  };
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Listeners must not break the FCM handler.
    }
  }
  return event;
}

export function subscribeForegroundPushEvents(
  listener: Listener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
