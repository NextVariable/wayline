import {
  entriesToTracks,
  type NativeEntry,
  type NativePlugin,
} from "./nativeFootprints";

export class StaleNativeRead extends Error {}
/** A single reader per hook; space switches invalidate in-flight pages before they can be published. */
export class NativeFootprintReader {
  private owner = "";
  private version = 0;
  private entries: NativeEntry[] = [];
  private pending: Promise<
    ReturnType<NativeFootprintReader["snapshot"]>
  > | null = null;
  constructor(private api: Pick<NativePlugin, "status" | "read">) {}
  selectOwner(owner: string) {
    if (owner === this.owner) return;
    this.owner = owner;
    this.version++;
    this.entries = [];
    this.pending = null;
  }
  private snapshot(status: Awaited<ReturnType<NativePlugin["status"]>>) {
    return {
      owner: this.owner,
      status,
      tracks: entriesToTracks(this.entries, status, Date.now()),
    };
  }
  refresh() {
    if (this.pending) return this.pending;
    const owner = this.owner,
      version = this.version;
    const check = () => {
      if (version !== this.version) throw new StaleNativeRead();
    };
    const request = (async () => {
      const status = await this.api.status({ owner });
      check();
      if (status.owner !== owner)
        throw new Error("Native footprint space mismatch");
      let after = this.entries.at(-1)?.id ?? 0;
      const entries = this.entries.slice();
      for (;;) {
        const { entries: page } = await this.api.read({
          owner,
          afterId: after,
          limit: 2000,
        });
        check();
        if (!page.length) break;
        for (const entry of page) {
          if (!Number.isSafeInteger(entry.id) || entry.id <= after)
            throw new Error("Invalid native cursor");
          after = entry.id;
          entries.push(entry);
        }
        if (page.length < 2000) break;
      }
      check();
      this.entries = entries;
      return this.snapshot(status);
    })();
    this.pending = request;
    void request.then(
      () => {
        if (version === this.version) this.pending = null;
      },
      () => {
        if (version === this.version) this.pending = null;
      },
    );
    return request;
  }
}
