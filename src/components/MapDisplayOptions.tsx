import { Bookmark, Check, Building2, Footprints, TrainFront, Map, Satellite, CalendarDays, Ticket } from "lucide-react";
import type { MapMode, SystemLayer } from "../types/place";

export function MapDisplayOptions({ mapMode, onMapModeChange, activeLayers, onToggleLayers, showLayers, multiCity = false, calendarLayer = true, onCalendarLayerChange, placeLayers, onPlaceLayerChange, trip = false }: {
  mapMode: MapMode;
  onMapModeChange: (mode: MapMode) => void;
  activeLayers: SystemLayer[];
  onToggleLayers: (layers: SystemLayer[]) => void;
  showLayers: boolean;
  multiCity?: boolean;
  calendarLayer?: boolean;
  onCalendarLayerChange?: (on: boolean) => void;
  placeLayers?: { saved: boolean; visited: boolean; booked: boolean };
  onPlaceLayerChange?: (layer: "saved" | "visited" | "booked", on: boolean) => void;
  trip?: boolean;
}) {
  return <div className="map-display-options">
    <div className="map-style-choices" role="group" aria-label="底图">
      {([{ id: "explore", label: "标准", icon: Map }, { id: "satellite", label: "卫星", icon: Satellite }] as const).map(({ id, label, icon: Icon }) =>
        <button key={id} title={id === "explore" ? "每天 06:00 切换日间，18:00 切换夜间" : undefined} aria-pressed={mapMode === id} onClick={() => onMapModeChange(id)}>
          <Icon size={17} aria-hidden="true" /><span>{label}</span>
          {mapMode === id && <Check className="map-style-check" size={16} aria-hidden="true" />}
        </button>)}
    </div>
    {showLayers && (onCalendarLayerChange || placeLayers) && <div className="map-layer-choices" role="group" aria-label="我的地点">
      {onCalendarLayerChange && <label>
        <CalendarDays size={17} aria-hidden="true" /><span>日程地点</span>
        <input type="checkbox" role="switch" aria-label="日程地点" checked={calendarLayer} onChange={event => onCalendarLayerChange(event.target.checked)} />
      </label>}
      {placeLayers && ([
        { key: "saved", label: "已存地点", icon: Bookmark },
        { key: "visited", label: "到访地点", icon: Footprints },
        ...(trip ? [{ key: "booked", label: "已订交通与住宿", icon: Ticket } as const] : []),
      ] as const).map(({key, label, icon: Icon}) => <label key={key}>
        <Icon size={17} aria-hidden="true" /><span>{label}</span>
        <input type="checkbox" role="switch" aria-label={label} checked={placeLayers[key]} onChange={event => onPlaceLayerChange?.(key, event.target.checked)} />
      </label>)}
    </div>}
    {showLayers && !trip && !multiCity && <div className="map-layer-choices" role="group" aria-label="显示地点">
      {([{ id: "business", label: "商务中心", icon: Building2 }, { id: "transport", label: "交通枢纽", icon: TrainFront }] as const).map(({ id, label, icon: Icon }) =>
        <label key={id}>
          <Icon size={17} aria-hidden="true" /><span>{label}</span>
          <input type="checkbox" role="switch" aria-label={label} checked={activeLayers.includes(id)} onChange={() => onToggleLayers([id])} />
        </label>)}
    </div>}
    {showLayers && !trip && multiCity && <p className="field-help">选择一个城市后可查看商务中心和交通枢纽。</p>}
  </div>;
}
