import { describe, expect, it, vi } from "vitest";
import { enqueueNotification, visibleNotifications, type NotificationItem } from "../lib/toastQueue";
const item = (id: string, message = "已更新"): NotificationItem => ({ id, message, variant: "info" });
const undo = (id: string): NotificationItem => ({ ...item(id), action: { label: "撤销", onClick: vi.fn() } });
describe("notification occupancy", () => {
  it("collapses a burst of identical messages to the latest notification", () => {
    let queue: NotificationItem[] = [];
    for (let n = 0; n < 100; n++) queue = enqueueNotification(queue, item(String(n)));
    expect(queue).toHaveLength(1);
    expect(visibleNotifications(queue)[0].id).toBe("99");
  });
  it("replaces stale routine updates with the current error", () => {
    const queue = enqueueNotification([item("a")], { ...item("b", "保存失败"), variant: "error" });
    expect(queue.map(x => x.message)).toEqual(["保存失败"]);
  });
  it("preserves independent undo operations but displays only the oldest and one update", () => {
    let queue = [undo("a"), undo("b"), item("c")];
    queue = enqueueNotification(queue, item("d"));
    expect(queue.map(x => x.id)).toEqual(["a", "b", "d"]);
    expect(visibleNotifications(queue).map(x => x.id)).toEqual(["a", "d"]);
    queue = queue.filter(x => x.id !== "a");
    expect(visibleNotifications(queue).map(x => x.id)).toEqual(["b", "d"]);
    visibleNotifications(queue)[0].action?.onClick();
    expect(queue[0].action?.onClick).toHaveBeenCalledOnce();
  });
  it("does not deduplicate independent actions with the same copy", () => {
    const queue = enqueueNotification([undo("a")], undo("b"));
    expect(queue).toHaveLength(2);
    expect(visibleNotifications(queue)).toHaveLength(1);
  });
});
