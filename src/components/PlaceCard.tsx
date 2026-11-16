import {
  ChevronLeft,
  Bookmark,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  
  Pencil,
  Plus,
} from "lucide-react";
import { safeExternalUrl } from "../lib/externalUrl";
import { officialAddressByName } from "../data/systemPlaces";
import { isSchedule } from "../lib/placeIdentity";
import { usePanelFocus } from "../lib/usePanelFocus";
import { categoryLabels } from "../lib/mapUtils";
import { placeMapLink } from "../lib/navigationLinks";
import type { Place } from "../types/place";
import { ActionMenu, type MenuAction } from "./ActionMenu";
import { useToast } from "./Toast";

type Props = {
  place: Place;
  onClose: () => void;
  
  onMarkVisited: (place: Place) => void;
  onAddToRoute?: (place: Place) => void;
  inRoute?: boolean;
  returnLabel: string;
  onEdit: () => void;
  savedPlace?: Place;
  onSave: () => void;
  onViewRoute?: () => void;
  onViewSchedule: () => void;
  /** Calendar events held at this place, shown with their time and its source. */
  calendarEvents?: { id: string; title: string; start: string; end: string; allDay: boolean }[];
};
const eventTime = (e: { start: string; end: string; allDay: boolean }) => {
  const start = new Date(e.start), end = new Date(e.end);
  const day = `${start.getMonth() + 1}/${start.getDate()}`;
  if (e.allDay) return `${day} 全天`;
  const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${day} ${hm(start)}–${hm(end)}`;
};
export function PlaceCard({
  place,
  onClose,
  
  onMarkVisited,
  onAddToRoute,
  inRoute,
  returnLabel,
  onEdit,
  savedPlace,
  onSave,
  onViewRoute,
  onViewSchedule,
  calendarEvents = [],
}: Props) {
  const evidence = place.resourceEvidence && typeof place.resourceEvidence === "object"
    ? place.resourceEvidence
    : undefined;
  const coordinateUrl = safeExternalUrl(evidence && "coordinateUrl" in evidence ? evidence.coordinateUrl : undefined);
  const officialUrl = safeExternalUrl(evidence && "officialUrl" in evidence ? evidence.officialUrl : undefined);
  const panel = usePanelFocus(true);
  const returningToSameView =
    (inRoute && returnLabel === "返回行程") ||
    (isSchedule(place) && returnLabel === "返回日程");
  
  const { addToast } = useToast();
  const schedule = isSchedule(place);
  const address = displayAddress(place);
  const actions: MenuAction[] = [
    {
      label: schedule ? "编辑日程" : savedPlace ? "编辑地点" : "保存地点",
      icon: <Pencil size={15} />,
      onSelect: schedule || savedPlace ? onEdit : onSave,
    },
  ];
  if (!schedule) {
    
    actions.push({
      label:
        (savedPlace ?? place).status === "visited"
          ? "再次记录到访"
          : "记录到访",
      icon: <CheckCircle2 size={15} />,
      onSelect: () => onMarkVisited(savedPlace ?? place),
    });
  }
  const map = placeMapLink(place);
  const rawNote = (
    schedule ? place.reason.split(" · ").slice(2).join(" · ") : place.reason
  )?.trim();
  const note = rawNote && !/来自.*(?:查询|搜索)|位置已匹配|地图已匹配|位置已确认|^地图中心|^距.*约/.test(rawNote) ? rawNote : "";
  const hours =
    place.openingHours &&
    !/待确认|以.*为准|公告|商户以现场/.test(place.openingHours)
      ? place.openingHours
      : "";
  return (
    <section
      ref={panel}
      className="place-detail workspace-panel"
      aria-label="地点详情"
    >
      <div className="detail-toolbar">
        <button className="text-action" onClick={onClose}>
          <ChevronLeft size={20} />
          {returnLabel.replace("列表", "")}
        </button>
        <div>
          {!savedPlace && !schedule && (
            <button className="text-action" onClick={onSave}>
              <Bookmark size={14} />
              保存
            </button>
          )}
          <ActionMenu label="地点操作" actions={actions} />
        </div>
      </div>
      <div className="detail-title">
        <h1>{place.name}</h1>
        {(schedule || place.city !== place.name) && <p>
          {schedule
            ? place.distanceText
            : place.category === "custom" ? place.city : `${place.city} · ${categoryLabels[place.category]}`}
        </p>}
      </div>
      {calendarEvents.length > 0 && <ul className="detail-calendar" aria-label="在这里的日程">
 {calendarEvents.map(e => <li key={e.id}>
   <strong>{e.title}</strong>
          <span><time dateTime={e.start}>{eventTime(e)}</time><span className="source-tag">日历</span></span>
        </li>)}
      </ul>}
      <div className="detail-primary-actions">
        {!returningToSameView && (schedule || onAddToRoute) && (
          <button
            className="primary-action"
            onClick={() =>
              schedule
                ? onViewSchedule()
                : inRoute
                  ? onViewRoute?.()
                  : onAddToRoute?.(place)
            }
          >
            {inRoute ? <Check size={16} /> : <Plus size={16} />}
            {schedule ? "查看日程" : inRoute ? "查看行程" : "加入行程"}
          </button>
        )}
        <a className="text-action detail-map-link" href={map.href} target={map.target} rel="noopener noreferrer">
          {map.label}<ExternalLink size={13} aria-hidden="true" />
        </a>
      </div>
      
      {address !== "地址待确认" && <div className="detail-address">
        <span>{address}</span>
        {address !== "地址待确认" && (
          <button
            className="icon-button"
            title="复制地址"
            aria-label="复制地址"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address);
                addToast("地址已复制", "success");
              } catch {
                addToast("未能复制，请选中地址手动复制", "error");
              }
            }}
          >
            <Copy size={15} />
          </button>
        )}
      </div>}
      {evidence && <div className="detail-facts">
        {evidence.provider !== "天地图" ? <>
          <p>点位来源 · {coordinateUrl
            ? <a className="text-action" href={coordinateUrl} target="_blank" rel="noreferrer">{evidence.provider}</a>
            : evidence.provider}</p>
          {officialUrl && <a className="text-action" href={officialUrl} target="_blank" rel="noreferrer">查看官方资料</a>}
        </> : <p>天地图 · 未核验</p>}
      </div>}
      {(schedule || hours) && (
        <dl className="detail-facts">
          <div>
            <dt>{schedule ? "安排时间" : "开放时间"}</dt>
            <dd>{schedule ? place.distanceText : hours}</dd>
          </div>
        </dl>
      )}
      {note && (schedule ? (
        <section className="detail-note">
          <h2>安排内容</h2>
          <p>{note}</p>
        </section>
      ) : (
        <details className="detail-note detail-note-disclosure">
          <summary>备注</summary>
          <p>{note}</p>
        </details>
      ))}
    </section>
  );
}
function displayAddress(place: Place) {
  const official =
    place.type === "system" ? officialAddressByName[place.name] : undefined;
  if (official) return official;
  const address = place.address.trim();
  if (
    !address ||
    address === place.name ||
    address === place.city ||
    `${place.city}${place.name}` === address ||
    /候选|附近|行政中心|行政区|官方交通枢纽|核心商务片区|官方校区|核心商业片区|官方景区|餐饮门店/.test(
      address,
    )
  )
    return "地址待确认";
  return address;
}
