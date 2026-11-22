import { useCallback, useEffect, useState } from "react";
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
  // Switching owners (for example leaving the demo workspace) must show the new
  // owner's city in the same render instead of flashing the previous owner's city.
  const current = view.userId === userId ? view : { ...readCityView(userId), userId };
  const setActiveCity = useCallback((activeCity: string) =>
    setView(previous => ({
      ...(previous.userId === userId ? previous : { ...readCityView(userId), userId }),
      activeCity, restored: true,
    })), [userId]);
  const setCityScope = useCallback((scope: CityScope) =>
    setView(previous => ({
      ...(previous.userId === userId ? previous : { ...readCityView(userId), userId }),
      scope, restored: true,
    })), [userId]);
  return {
    ...current,
    setActiveCity,
    setCityScope,
    selectCities: (names: string[]) => setView(previous => {
      const base = previous.userId === userId ? previous : { ...readCityView(userId), userId };
      const selectedCities = Array.from(new Set(names.filter(name => name.trim())));
      if (!selectedCities.length) return base;
      return { ...base, activeCity: selectedCities.find(name => cityKey(name) === cityKey(base.activeCity)) ?? selectedCities[0],
        scope: selectedCities.length > 1 ? "selected" : "current", selectedCities, restored: true };
    }),
  };
}
