import { describe, expect, it } from "vitest";
import { getCityGuideCategoryPlaces, getCityGuidePlaces } from "../lib/guideFilters";
import type { Place } from "../types/place";

const basePlace: Place = {
  id: "p1",
  name: "测试地点",
  city: "深圳",
  category: "business",
  guideCategories: ["business", "food"],
  type: "user",
  source: "manual",
  lat: 22.5431,
  lng: 114.0579,
  address: "深圳",
  openingHours: "以现场为准",
  description: "测试",
  tags: [],
  reason: "测试",
  status: "saved",
  isSaved: true,
  distanceText: "已添加",
  externalLinks: {},
};

describe("guideFilters", () => {
  
  it("treats total guide as all user places in the selected city", () => {
    expect(getCityGuidePlaces([basePlace], "深圳")).toHaveLength(1);
    expect(getCityGuidePlaces([basePlace], "广州")).toHaveLength(0);
  });

  it("allows one place to appear in multiple guide branches", () => {
    expect(getCityGuideCategoryPlaces([basePlace], "深圳", "business")).toHaveLength(1);
    expect(getCityGuideCategoryPlaces([basePlace], "深圳", "food")).toHaveLength(1);
    expect(getCityGuideCategoryPlaces([basePlace], "深圳", "university")).toHaveLength(0);
  });
});
