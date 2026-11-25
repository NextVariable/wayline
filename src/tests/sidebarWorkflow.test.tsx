import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { Sidebar } from "../components/Sidebar";
import { ToastProvider } from "../components/Toast";
import { initialUserPlaces } from "./fixtures/userPlaces";
const noop = () => {};
function render(patch: Partial<ComponentProps<typeof Sidebar>>) {
  const props: ComponentProps<typeof Sidebar> = {ownerId:"guest",activeCity:"深圳",selectedCities:["深圳"],activeFilter:{kind:"status",value:"visited",label:"已到访"},detailOpen:false,overviewRequest:0,userPlaces:[],visitedPlaces:[],onFilterChange:noop,onSelectPlace:noop,isOpen:true,onToggleOpen:noop,onSearchPlaces:async()=>[],onCreatePlace:noop,onDeletePlace:noop,onEditPlace:noop,storageHealthy:true,onOpenBusinessTrips:noop,onOpenSearch:noop,onNavigatePanel:update=>update(),...patch};
  return renderToStaticMarkup(<ToastProvider><Sidebar {...props} /></ToastProvider>);
}
it("shows an independently visited place without calling it a saved place", () => {
  const place = {...initialUserPlaces[0],id:"visit",name:"独立到访会场",status:"visited" as const,isSaved:false};
  const html = render({visitedPlaces:[place]});
  expect(html).toContain("独立到访会场"); expect(html).toContain('aria-label="保存独立到访会场"');
  expect(html).not.toContain("暂无已到访地点");
});
it("offers one trip entry and removes the old planning shortcut", () => {
  const html = render({activeFilter:{kind:"status",value:"all",label:"全部地点"}});
  expect(html.match(/data-library-destination="business-trips"/g)).toHaveLength(1);
  expect(html).not.toContain('data-library-destination="planner"');
});

it("keeps the home as compact destinations without guide collections or invented recent places",()=>{
 const html=render({activeFilter:{kind:"status",value:"all",label:"全部地点"}});
 expect(html).toContain('aria-label="工作区与地点"');expect(html).toContain('data-library-destination="saved"');expect(html).toContain('行程');expect(html).not.toContain('>指南<');
 expect(html).not.toContain('最近搜索');expect(html).not.toContain('暂无保存地点');
 expect(html).toContain('placeholder="搜索地点或地址"');
});
