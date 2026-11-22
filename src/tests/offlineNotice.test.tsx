import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OfflineNoticeView } from "../components/OfflineNotice";

it("stays out of the way while the network is up", () => {
  expect(renderToStaticMarkup(<OfflineNoticeView online wasOffline={false} />)).toBe("");
});

it("says routes and sync may be stale while offline", () => {
  const html = renderToStaticMarkup(<OfflineNoticeView online={false} wasOffline={false} />);
  expect(html).toContain('role="status"');
  expect(html).toContain("当前离线");
});

it("confirms recovery after a drop", () => {
  const html = renderToStaticMarkup(<OfflineNoticeView online wasOffline />);
  expect(html).toContain("网络已恢复");
});
