import { describe, expect, it } from "vitest";
import { getCitiesGuideCategoriesPlaces, getCitiesGuideCategoryPlaces, getCitiesGuidePlaces, groupSavedPlacesByCity, savedPlaceAddress } from "../lib/guideFilters";
import type { Place } from "../types/place";

const makePlace = (id: string, city: string, guideCategories: Place["guideCategories"]): Place => ({
  id,
  name: id,
  city,
  category: guideCategories?.[0] ?? "custom",
  guideCategories,
  type: "user",
  source: "manual",
  lat: 0,
  lng: 0,
  address: city,
  openingHours: "以现场为准",
  description: id,
  tags: [],
  reason: id,
  status: "saved",
  isSaved: true,
  distanceText: "mock",
  externalLinks: {},
});

describe("saved places grouped by city", () => {
  it("merges legacy city labels and keeps every place in its original order within the group", () => {
    const places = [makePlace("虎丘", "江苏省苏州市姑苏区", []), makePlace("外滩", "上海", []), makePlace("园区", "苏州", []), makePlace("旧地点", "", [])];
    expect(groupSavedPlacesByCity(places).map(group => [group.label, group.places.map(place => place.id)]))
      .toEqual([["上海", ["外滩"]], ["苏州", ["虎丘", "园区"]], ["城市未识别", ["旧地点"]]]);
  });

  it("removes only repeated city or venue labels from the visible subtitle", () => {
    const place = makePlace("虎丘山风景区", "苏州", []);
    expect(savedPlaceAddress({ ...place, address: "江苏省苏州市姑苏区虎丘路8号" }, "苏州")).toBe("姑苏区虎丘路8号");
    expect(savedPlaceAddress({ ...place, address: "苏州市 虎丘山风景区" }, "苏州")).toBe("");
    expect(savedPlaceAddress({ ...place, address: "苏州大道8号" }, "苏州")).toBe("苏州大道8号");
    expect(savedPlaceAddress({ ...place, address: "浙江省杭州市西湖区" }, "苏州")).toBe("浙江省杭州市西湖区");
  });
});

describe("multi-city guide filters", () => {
  it("combines total guide places across selected cities", () => {
    const places = [makePlace("北京点", "北京", ["business"]), makePlace("深圳点", "深圳", ["food"]), makePlace("广州点", "广州", ["food"])];

    expect(getCitiesGuidePlaces(places, ["北京", "深圳"]).map((place) => place.name)).toEqual(["北京点", "深圳点"]);
  });

  it("combines branch places across selected cities", () => {
    const places = [makePlace("北京商务", "北京", ["business"]), makePlace("深圳美食", "深圳", ["food"]), makePlace("上海商务", "上海", ["business"])];

    expect(getCitiesGuideCategoryPlaces(places, ["北京", "上海"], "business").map((place) => place.name)).toEqual(["北京商务", "上海商务"]);
  });

  it("supports a combined food and shopping guide branch", () => {
    const places = [makePlace("深圳美食", "深圳", ["food"]), makePlace("深圳商圈", "深圳", ["shopping"]), makePlace("深圳交通", "深圳", ["transport"])];

    expect(getCitiesGuideCategoriesPlaces(places, ["深圳"], ["food", "shopping"]).map((place) => place.name)).toEqual(["深圳美食", "深圳商圈"]);
  });
});
