import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaceCard } from "../components/PlaceCard";
import { ToastProvider } from "../components/Toast";
import { initialUserPlaces } from "./fixtures/userPlaces";

const noop = () => {};

function render(coordinateUrl: string, officialUrl: string) {
  return renderToStaticMarkup(<ToastProvider><PlaceCard
    place={{ ...initialUserPlaces[0], resourceEvidence: { provider: "官方地图", coordinateUrl, officialUrl } }}
    onClose={noop} onMarkVisited={noop} returnLabel="返回地点"
    onEdit={noop} onSave={noop} onViewSchedule={noop}
  /></ToastProvider>);
}

describe("place evidence links", () => {
  it("shows an external link for HTTPS sources", () => {
    const markup = render("https://example.org/map", "https://example.org/place");
    expect(markup).toContain('href="https://example.org/map"');
    expect(markup).toContain('href="https://example.org/place"');
  });

  it("keeps the source label when evidence URLs cannot be opened", () => {
    const markup = render("data:text/plain,untrusted", "https://user@example.org/place");
    expect(markup).toContain("官方地图");
    expect(markup).not.toContain("查看官方资料");
    expect(markup).not.toContain("example.org");
    expect(markup).not.toContain("data:text/plain");
  });
});
