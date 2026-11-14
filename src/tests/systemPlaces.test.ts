import { describe, expect, it } from "vitest";
import { coreCityNames } from "../data/cities";
import { seedSystemPlaces as systemPlaces } from "../data/seedCityResources";
import type { SystemLayer } from "../types/place";

describe("archived approximate UI fixtures (not production coverage)", () => {
  it("retains historical transport and business fixtures for Beijing, Shanghai, Guangzhou and Shenzhen", () => {
    const requiredLayers: SystemLayer[] = ["transport", "business"];

    for (const city of coreCityNames) {
      for (const layer of requiredLayers) {
        expect(
          systemPlaces.some(
            (place) => place.city === city && place.category === layer,
          ),
          `${city} should include ${layer} system resources`,
        ).toBe(true);
      }
    }
  });

  it("preserves the original sample counts in each core city", () => {
    const minimums: Partial<Record<SystemLayer, number>> = {
      transport: 4,
      business: 4,
    };

    for (const city of coreCityNames) {
      for (const [layer, minimum] of Object.entries(minimums) as Array<
        [SystemLayer, number]
      >) {
        const count = systemPlaces.filter(
          (place) => place.city === city && place.category === layer,
        ).length;
        expect(
          count,
          `${city} ${layer} should include at least ${minimum} resources`,
        ).toBeGreaterThanOrEqual(minimum);
      }
    }
  });

  it("only offers business and transport automatically", () => {
    expect(systemPlaces.length).toBe(38);
    expect(
      systemPlaces.every(
        (p) => p.category === "business" || p.category === "transport",
      ),
    ).toBe(true);
  });

  it("uses only the imported seed resources and does not expose old mock/fabricated resources", () => {
    expect(
      systemPlaces.some((place) =>
        /mock|苏州工业园区口岸|苏州工业园区轮渡码头|园区研究生院|苏州机场/.test(
          place.name,
        ),
      ),
    ).toBe(false);
    expect(systemPlaces.some((place) => place.city === "成都")).toBe(true);
  });
});
