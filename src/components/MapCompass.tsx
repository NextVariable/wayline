export function MapCompass({ rotation, onReset }: { rotation: number | null; onReset: () => void }) {
  const northUp = rotation !== null && (rotation < 0.5 || rotation > 359.5);
  const label = rotation === null ? "指南针，地图加载中" : northUp ? "指南针，正北朝上" : "指南针，恢复正北朝上";
  return <div className="map-control-group map-compass-group">
    <button className="map-compass" aria-label={label} title={label} disabled={rotation === null} onClick={onReset}>
      <svg className="map-compass-dial" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth=".8" />
        <g stroke="currentColor" strokeOpacity=".4" strokeWidth="1">
          <path d="M2 16h3M27 16h3M16 27v3" />
        </g>
        <g transform={`rotate(${-(rotation ?? 0)} 16 16)`}>
          <text x="16" y="10" textAnchor="middle" fill="currentColor" fontSize="7" fontWeight="600">N</text>
          <path d="M16 12l4 8-4-2-4 2z" fill="#e95858" />
          <path d="M12 20l4-2 4 2-4 6z" fill="currentColor" opacity=".7" />
        </g>
      </svg>
    </button>
  </div>;
}
