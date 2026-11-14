import { describe, expect, it } from "vitest";
import { renderPlacePinHTML } from "../components/PlacePin";
import { initialUserPlaces } from "../data/userPlaces";
describe("shared map markers", () => {
  it("escapes imported names and schedule text", () => {
    const place = {
      ...initialUserPlaces[0],
      name: '<img src=x onerror="alert(1)">',
      tags: ["日程助手"],
      distanceText: "<script>bad</script>",
    };
    const html = renderPlacePinHTML(place, false, "young");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
  });
  it("puts the route order inside the marker for both map providers", () => {
    expect(
      renderPlacePinHTML(initialUserPlaces[0], true, "young", 2),
    ).toContain('class="pin-sequence">3</span>');
    expect(
      renderPlacePinHTML(initialUserPlaces[0], false, "young"),
    ).not.toContain('class="pin-sequence"');
  });
});
