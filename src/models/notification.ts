export type NotificationCategory =
  | "permissionRequest"
  | "idleAlert"
  | "elicitationDialog"
  | "sessionLifecycle"
  | "toolFailed"
  | "taskCompleted";

export type NotificationPriority = "urgent" | "high" | "normal" | "low";

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  sessionId?: string;
  createdAt: Date;
  read: boolean;
}

export function createNotification(
  title: string,
  body: string,
  category: NotificationCategory,
  priority: NotificationPriority,
  sessionId?: string,
): AppNotification {
  return {
    id: crypto.randomUUID(),
    title,
    body,
    category,
    priority,
    sessionId,
    createdAt: new Date(),
    read: false,
  };
}

export const PRIORITY_ORDER: Record<NotificationPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};
