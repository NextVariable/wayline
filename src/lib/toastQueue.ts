export interface NotificationItem {
  id: string;
  message: string;
  variant: "success" | "error" | "info";
  action?: { label: string; onClick: () => void; dismissLabel?: string }; // dismissLabel: worded decline instead of the close icon
}

/** Routine updates replace one another. Keep independent undo actions available. */
export function enqueueNotification(queue: NotificationItem[], incoming: NotificationItem): NotificationItem[] {
  return incoming.action ? [...queue, incoming] : [...queue.filter(item => item.action), incoming];
}

/** At most one action and one routine notification can occupy the map. */
export function visibleNotifications(queue: NotificationItem[]): NotificationItem[] {
  const action = queue.find(item => item.action);
  const routine = queue.find(item => !item.action);
  return [action, routine].filter((item): item is NotificationItem => !!item);
}
