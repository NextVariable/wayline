import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "../components/Toast";
import { AuthPanel } from "../components/AuthPanel";
import { guestUser } from "../lib/userStorage";
import { DEMO_USER } from "../lib/demoWorkspace";
const noop=()=>{};
it("leaves local space creation out and explains local storage to a guest",()=>{
 const html=renderToStaticMarkup(<ToastProvider><AuthPanel user={guestUser} accountStatus="guest" syncState="off" onSignIn={noop} onSignOut={noop} onLogin={noop} open onClose={noop} getFootprints={async()=>({version:1,tracks:[],visits:[],activeId:null})}/></ToastProvider>);
 expect(html).toContain("资料与备份");expect(html).not.toContain("新建本地空间");expect(html).toContain("换设备前请导出备份");expect(html).not.toContain('aria-label="已有空间"');
});
it("does not export the synthetic demo workspace as a real backup",()=>{
 const html=renderToStaticMarkup(<ToastProvider><AuthPanel user={DEMO_USER} accountStatus="guest" syncState="off" onSignIn={noop} onSignOut={noop} onLogin={noop} open onClose={noop} getFootprints={async()=>({version:1,tracks:[],visits:[],activeId:null})}/></ToastProvider>);
 expect(html).toContain("演示工作区为合成数据，不可导出");
 expect(html).toContain("disabled");
});
