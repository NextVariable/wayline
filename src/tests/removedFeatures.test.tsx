import {expect, it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync, existsSync, readdirSync} from "node:fs";
import {resolve} from "node:path";
import {Sidebar} from "../components/Sidebar";
import {ToastProvider} from "../components/Toast";
import {initialUserPlaces} from "./fixtures/userPlaces";

// Features removed by the 2026-11-12 positioning (docs/design/positioning.md).
const root = resolve(__dirname, "../..");
export const sourceOf = (path: string) => readFileSync(resolve(root, path), "utf8");
const componentSources = () => readdirSync(resolve(root, "src/components")).filter(f => f.endsWith(".tsx")).map(f => sourceOf(`src/components/${f}`)).join("\n");
const noop = () => {};
// Props are passed loosely on purpose: the removed guide props must not be required any more.
const renderSidebar = (patch: Record<string, unknown>) => renderToStaticMarkup(<ToastProvider><Sidebar {...({
  ownerId: "guest", activeCity: "深圳", selectedCities: ["深圳"], activeFilter: {kind: "status", value: "all", label: "全部地点"},
  detailOpen: false, overviewRequest: 0, userPlaces: [], visitedPlaces: [], onFilterChange: noop, onSelectPlace: noop, isOpen: true,
  onToggleOpen: noop, onSearchPlaces: async () => [], onCreatePlace: noop, onDeletePlace: noop, onEditPlace: noop, storageHealthy: true,
  onAddToRoute: noop, routePlaces: [], onOpenPlanner: noop, onOpenFootprints: noop, onOpenSearch: noop, ...patch,
} as any)} /></ToastProvider>);

it("offers no user-made guide collections anywhere in the interface", () => {
  const ui = componentSources() + sourceOf("src/App.tsx");
  for (const text of ["新建指南", "加入指南", "添加到指南", "拖入指南", 'label="指南"']) expect(ui).not.toContain(text);
});
it("falls back to all saved places when a leftover guide filter is active", () => {
  const place = {...initialUserPlaces.find(p => p.city === "深圳")!, isSaved: true};
  const html = renderSidebar({activeFilter: {kind: "customGuide", value: "旧指南", label: "旧指南"}, userPlaces: [place]});
  expect(html).not.toContain("旧指南");
  expect(html).toContain('aria-label="行程与地点"');
});
it("still lists a stored place that carries old guide membership", () => {
  const place = {...initialUserPlaces.find(p => p.city === "深圳")!, isSaved: true, customGuideNames: ["旧指南"]};
  const html = renderSidebar({activeFilter: {kind: "status", value: "all", label: "全部地点"}, userPlaces: [place]});
  expect(html).toContain(place.name);
  expect(html).not.toContain("旧指南");
});
export {componentSources, root, existsSync};
it("has no bulk place import entry or dialog", () => {
  expect(existsSync(resolve(root, "src/components/ImportPlacesModal.tsx"))).toBe(false);
  expect(componentSources() + sourceOf("src/App.tsx")).not.toContain("导入地点");
});
it("has no fare watch service, route or controls", () => {
  expect(existsSync(resolve(root, "server/flight-watches.mjs"))).toBe(false);
  expect(sourceOf("server/index.mjs")).not.toContain("/api/flight-watch");
  const ui = componentSources();
  for (const text of ["开始关注", "停止关注", "价格关注", "flight-watch"]) expect(ui).not.toContain(text);
});
it("labels the remaining sidebar tool as backup instead of a generic add menu", () => {
  const html = renderSidebar({onOpenWorkspace: noop});
  expect(html).not.toContain("添加与管理");
  expect(html).toContain('aria-label="资料与备份"');
  expect(renderSidebar({})).not.toContain('aria-label="资料与备份"');
});
