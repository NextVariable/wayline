import { useEffect, useState } from "react";
import type { BookingChange, GmailBooking, RailOrder } from "./businessOrders";

export interface Mailbox { connected: boolean; lastSync: number | null; orders: RailOrder[]; bookings?: GmailBooking[]; singleSample?: boolean; changes?: BookingChange[]; partial?: boolean; uncertain?: boolean; needsReconnect?: boolean }
export function useTripMailbox(owner?: string) {
  const [view, setView] = useState<{ owner: string; mailbox: Mailbox }>();
  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    let running = false;
    let queued = false;
    const read = async (action: "status" | "sync"): Promise<Mailbox | null> => {
      const response = await fetch(`/api/auth/gmail/${action}`, { cache: "no-store", signal: controller.signal,
        ...(action === "sync" && { method:"POST", headers:{"Content-Type":"application/json"}, body:"{}" }) });
      if (response.status === 401 && action === "status") return { connected:false, lastSync:null, orders:[] };
      if (!response.ok) return null;
      return await response.json() as Mailbox;
    };
    const refresh = async () => {
      if (controller.signal.aborted || document.visibilityState === "hidden") return;
      if (running) { queued = true; return; }
      running = true;
      try {
        const mailbox = await read("status");
        if (!mailbox || controller.signal.aborted || queued) return;
        setView({ owner, mailbox });
        if (mailbox.connected && !mailbox.singleSample && !mailbox.needsReconnect && (!mailbox.lastSync || Date.now() - mailbox.lastSync >= 15 * 60_000)) {
          const fresh = await read("sync");
          if (!controller.signal.aborted && !queued) setView({ owner, mailbox:fresh ?? {...mailbox, uncertain:true} });
        }
      } catch {
        if (!controller.signal.aborted)
          setView(previous => previous?.owner === owner ? {owner,mailbox:{...previous.mailbox,uncertain:true}} : previous);
      }
      finally {
        running = false;
        if (queued) { queued = false; void refresh(); }
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("wayline:gmail-change", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("wayline:gmail-change", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [owner]);
  return view?.owner === owner && view?.mailbox.connected ? view.mailbox : undefined;
}
