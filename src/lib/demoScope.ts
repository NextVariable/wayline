const DEMO_FLAG = "wayline.demo.active";
let unsavedMode: boolean | undefined;

export function readDemoMode() {
  if (unsavedMode !== undefined) return unsavedMode;
  try { return sessionStorage.getItem(DEMO_FLAG) === "1"; } catch { return false; }
}

export function setDemoFlag(on: boolean) {
  try {
    if (on) sessionStorage.setItem(DEMO_FLAG, "1");
    else sessionStorage.removeItem(DEMO_FLAG);
    unsavedMode = undefined;
  } catch { unsavedMode = on; }
}
