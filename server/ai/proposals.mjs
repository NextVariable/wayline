/**
 * Proposed actions live only until the user confirms them.
 *
 * A proposal is created from validated model output, previewed in the UI, and
 * then confirmed once. Confirmation re-checks owner, freshness, workspace
 * version and single use before returning the authorized payload. Nothing is
 * written to a schedule before this step.
 */
import { createHash, randomUUID } from "node:crypto";

const TTL_MS = 10 * 60_000;

export function createProposalStore({ now = Date.now, ttlMs = TTL_MS } = {}) {
  const proposals = new Map();
  const digest = (payload) => createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);

  const prune = () => {
    const cutoff = now() - ttlMs;
    for (const [id, proposal] of proposals) {
      if (proposal.createdAt < cutoff) proposals.delete(id);
    }
  };

  return {
    create({ owner, payload, summary = "" }) {
      prune();
      const proposalId = randomUUID();
      const record = {
        proposalId,
        owner,
        payload: { ...payload, proposalId },
        baseVersion: payload.baseVersion ?? "",
        payloadHash: digest(payload),
        summary,
        createdAt: now(),
        expiresAt: now() + ttlMs,
        used: false,
      };
      proposals.set(proposalId, record);
      return {
        proposalId,
        payload: record.payload,
        baseVersion: record.baseVersion,
        payloadHash: record.payloadHash,
        summary,
        expiresAt: record.expiresAt,
      };
    },
    confirm({ owner, proposalId, baseVersion, payloadHash }) {
      const record = proposals.get(String(proposalId ?? ""));
      if (!record) return { ok: false, code: "proposal_not_found", status: 404, message: "提案不存在或已过期" };
      if (record.owner !== owner) return { ok: false, code: "proposal_forbidden", status: 403, message: "提案不属于当前账号" };
      if (record.used) return { ok: false, code: "already_confirmed", status: 409, message: "该提案已执行，不会重复保存" };
      if (record.createdAt + ttlMs < now()) {
        proposals.delete(record.proposalId);
        return { ok: false, code: "proposal_expired", status: 410, message: "提案已过期，请重新生成预览" };
      }
      // A confirm that omits the version must not bypass the stale check.
      if (record.baseVersion && String(baseVersion ?? "") !== record.baseVersion)
        return { ok: false, code: "stale_proposal", status: 409, message: "来源已更新，请重新预览后再确认" };
      if (payloadHash && payloadHash !== record.payloadHash)
        return { ok: false, code: "payload_changed", status: 409, message: "提案内容不一致，请重新预览" };
      record.used = true;
      return { ok: true, status: 200, code: "confirmed", proposal: record.payload };
    },
    size: () => proposals.size,
    forgetOwner(owner) {
      for (const [id, proposal] of proposals) if (proposal.owner === owner) proposals.delete(id);
    },
  };
}
