import { useEffect, useState } from "react";
import { cityKey, type CityScope } from "./citySelection";
export function readCityView(userId: string): {
  activeCity: string;
  scope: CityScope;
  restored: boolean;
  selectedCities?: string[];
} {
  try {
    const value = JSON.parse(
      localStorage.getItem("whereto:city-view:" + userId) ?? "null",
    );
    if (
      value &&
      typeof value.activeCity === "string" &&
      value.activeCity.trim() &&
      value.activeCity.length <= 60 &&
      ["current", "all", "selected"].includes(value.scope)
    ) {
      if (value.scope === "selected") {
        const names = Array.isArray(value.selectedCities)
          ? [...new Set(value.selectedCities.filter((name: unknown): name is string => typeof name === "string" && !!name.trim() && name.length <= 60))] as string[]
          : [];
        if (names.length) return {
          activeCity: names.includes(value.activeCity) ? value.activeCity : names[0],
          scope: names.length > 1 ? "selected" : "current", selectedCities: names, restored: true,
        };
      }
      return {
        activeCity: value.activeCity,
        scope: value.scope === "selected" ? "current" : value.scope,
        restored: true,
      };
    }
  } catch {
    /* A damaged preference never prevents opening the workspace. */
  }
  return { activeCity: "深圳", scope: "current", restored: false };
}
export function useCityView(userId: string) {
  const [view, setView] = useState(() => ({ ...readCityView(userId), userId }));
  useEffect(() => {
    if (view.userId !== userId) {
      setView({ ...readCityView(userId), userId });
      return;
    }
    if (!view.restored) return;
    try {
      localStorage.setItem(
        "whereto:city-view:" + userId,
        JSON.stringify({ activeCity: view.activeCity, scope: view.scope, selectedCities: view.selectedCities }),
      );
    } catch {
      /* Browsing still works without persisted preferences. */
    }
  }, [view, userId]);
  return {
    ...view,
    setActiveCity: (activeCity: string) =>
      setView((previous) => ({ ...previous, activeCity, restored: true })),
    setCityScope: (scope: CityScope) =>
      setView((previous) => ({ ...previous, scope, restored: true })),
    selectCities: (names: string[]) => setView(previous => {
      const selectedCities = Array.from(new Set(names.filter(name => name.trim())));
      if (!selectedCities.length) return previous;
      return { ...previous, activeCity: selectedCities.find(name => cityKey(name) === cityKey(previous.activeCity)) ?? selectedCities[0],
        scope: selectedCities.length > 1 ? "selected" : "current", selectedCities, restored: true };
    }),
  };
}
