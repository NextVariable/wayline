import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Place, PlaceCategory } from "../types/place";
import { categoryLabels } from "../lib/mapUtils";
import { usePanelFocus } from "../lib/usePanelFocus";

export function PlaceEditor({
  place,
  
  onSave,
  onClose,
}: {
  place: Place;
  
  onSave: (place: Place) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({ ...place });
  const [tagText, setTagText] = useState(place.tags.join("，"));
  const ref = usePanelFocus(true);
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    const prior = root.inert;
    root.inert = true;
    return () => {
      root.inert = prior;
    };
  }, []);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(place) ||
    tagText !== place.tags.join("，");
  const close = () => {
    if (!dirty || window.confirm("放弃尚未保存的地点修改？")) onClose();
  };
  return createPortal(
    <div
      className="editor-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        ref={ref}
        className="place-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="place-editor-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
          }
          if (event.key !== "Tab" || !ref.current) return;
          const fields = Array.from(
            ref.current.querySelectorAll<HTMLElement>(
              "button:not([disabled]), input:not([disabled]), textarea, select",
            ),
          );
          const first = fields[0],
            last = fields[fields.length - 1];
          if (!fields.includes(document.activeElement as HTMLElement)) {
            event.preventDefault();
            (event.shiftKey ? last : first)?.focus();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="panel-heading">
          <h2 id="place-editor-title">编辑地点</h2>
          <button
            className="icon-button"
            aria-label="取消编辑地点"
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        <form
          className="workspace-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.name.trim()) return;
            onSave({
              ...draft,
              name: draft.name.trim(),
              address: draft.address.trim(),
              reason: draft.reason.trim(),
              tags: Array.from(
                new Set(
                  tagText
                    .split(/[,，]/)
                    .map((t) => t.trim())
                    .filter(Boolean),
                ),
              ),
            });
          }}
        >
          <label htmlFor="edit-place-name">地点名称</label>
          <input
            id="edit-place-name"
            data-autofocus
            required
            maxLength={120}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <label htmlFor="edit-place-address">地址</label>
          <input
            id="edit-place-address"
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            aria-describedby="address-help"
          />
          <p className="field-help" id="address-help">
            更换位置需重新搜索地点。
          </p>
          <label htmlFor="edit-place-note">备注</label>
          <textarea
            id="edit-place-note"
            rows={3}
            value={draft.reason}
            onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            placeholder="联系人、楼层、会面要求等"
          />
          <details className="smart-options">
            <summary>分类与标签</summary>
            <div className="smart-options-body">
              <label htmlFor="edit-place-tags">标签（逗号分隔）</label>
              <input
                id="edit-place-tags"
                value={tagText}
                onChange={(event) => setTagText(event.target.value)}
                placeholder="例如：客户、会场、需预约"
              />
              <fieldset>
                <legend>地点分类</legend>
                <div className="choice-chips">
                  {(Object.keys(categoryLabels) as PlaceCategory[])
                    .filter((c) => c !== "custom")
                    .map((category) => (
                      <label key={category}>
                        <input
                          type="checkbox"
                          checked={(
                            draft.guideCategories ?? [draft.category]
                          ).includes(category)}
                          onChange={(e) => {
                            const current = draft.guideCategories ?? [
                              draft.category,
                            ];
                            setDraft({
                              ...draft,
                              guideCategories: e.target.checked
                                ? [...current, category]
                                : current.filter((c) => c !== category),
                            });
                          }}
                        />
                        {categoryLabels[category]}
                      </label>
                    ))}
                </div>
              </fieldset>
              
            </div>
          </details>
          <div className="form-actions">
            <button type="button" className="secondary-action" onClick={close}>
              取消
            </button>
            <button className="primary-action" disabled={!draft.name.trim()}>
              <Check size={16} />
              保存修改
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}
