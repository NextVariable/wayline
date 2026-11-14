import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import {createPortal} from 'react-dom';
import { wgsToGcj, gcjToWgs } from '../lib/trackCoordinates';
export type MapViewport = {
    center: {
        lat: number;
        lng: number;
    };
    bounds?: {
        north: number;
        south: number;
        east: number;
        west: number;
    };
};
export type ChinaMiniMapProps = {
    mainMapCenter: MapViewport['center'];
    mainMapBounds?: MapViewport['bounds'];
    onJumpToLocation: (lat: number, lng: number) => void;
    amap?: any;
    /** Follows the main map so the overview never flashes light over a dark map. */
    appearance?: 'young' | 'business';
};
const BOUNDS: [
    [
        number,
        number
    ],
    [
        number,
        number
    ]
] = [[15, 70], [55, 140]];
/** Fixed national overview; the provider draws boundaries, never generated geometry. */
export function ChinaMiniMap({ mainMapCenter, mainMapBounds, onJumpToLocation, amap, appearance = 'young' }: ChinaMiniMapProps) {
    const dark = appearance === 'business';
    const container = useRef<HTMLDivElement>(null), map = useRef<any>(null), frame = useRef<any>(null), dot = useRef<any>(null);
    const jump = useRef(onJumpToLocation);
    const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width:700px)').matches);
    jump.current = (lat,lng) => {
        onJumpToLocation(lat,lng);
        if(window.matchMedia('(max-width:700px)').matches)setCollapsed(true);
    };
    useEffect(() => { const media = window.matchMedia('(max-width:700px)'); const compact = () => { if (media.matches)
        setCollapsed(true); }; media.addEventListener('change', compact); return () => media.removeEventListener('change', compact); }, []);
    useEffect(() => {
        if (collapsed || !container.current)
            return;
        const element = container.current;
        let fit: () => void, cleanup: () => void;
        if (amap) {
            const mini = new amap.Map(element, { center: [105, 35], zoom: 2, zooms: [2, 5], viewMode: '2D', dragEnable: false, zoomEnable: false, scrollWheel: false, doubleClickZoom: false, touchZoom: false, keyboardEnable: false, rotateEnable: false, showLabel: false, mapStyle: dark ? 'amap://styles/dark' : 'amap://styles/whitesmoke', features: ['bg', 'road'], resizeEnable: true });
            map.current = mini;
            fit = () => mini.setZoomAndCenter(2, [105, 35], true);
            fit();
            mini.on('click', (e: any) => { const [lng, lat] = gcjToWgs(e.lnglat.lng, e.lnglat.lat); jump.current(lat, lng); });
            cleanup = () => mini.destroy();
        }
        else {
            const mini = L.map(element, { center: [35, 105], zoom: 2, minZoom: 0, maxZoom: 5, zoomSnap: 0, zoomControl: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, dragging: false, touchZoom: false, fadeAnimation: false, zoomAnimation: false });
            map.current = mini;
            L.DomEvent.disableClickPropagation(element);
            L.DomEvent.disableScrollPropagation(element);
            L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`, { attribution: '© OpenStreetMap © CARTO', noWrap: true }).addTo(mini);
            fit = () => { mini.invalidateSize(false); mini.fitBounds(BOUNDS, { animate: false, padding: [4, 4] }); };
            fit();
            mini.on('click', e => jump.current(e.latlng.lat, e.latlng.lng));
            cleanup = () => mini.remove();
        }
        const observer = new ResizeObserver(fit);
        observer.observe(element);
        return () => { observer.disconnect(); cleanup(); map.current = null; frame.current = null; dot.current = null; };
    }, [amap, collapsed, dark]);
    useEffect(() => {
        const mini = map.current;
        if (!mini)
            return;
        if (amap) {
            if (frame.current)
                mini.remove(frame.current);
            if (dot.current)
                mini.remove(dot.current);
            if (mainMapBounds) {
                const b = mainMapBounds;
                frame.current = new amap.Polygon({ path: [[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north]].map(([lng, lat]) => wgsToGcj(lng, lat)), strokeColor: '#155bd0', strokeWeight: 1, fillColor: '#155bd0', fillOpacity: .1, bubble: true });
                mini.add(frame.current);
            }
            dot.current = new amap.CircleMarker({ center: wgsToGcj(mainMapCenter.lng, mainMapCenter.lat), radius: 3, strokeColor: '#fff', strokeWeight: 1, fillColor: '#155bd0', fillOpacity: 1, bubble: true });
            mini.add(dot.current);
        }
        else {
            frame.current?.remove();
            dot.current?.remove();
            if (mainMapBounds) {
                const b = mainMapBounds;
                frame.current = L.rectangle([[b.south, b.west], [b.north, b.east]], { color: '#155bd0', weight: 1, fillOpacity: .1, interactive: false }).addTo(mini);
            }
            dot.current = L.circleMarker([mainMapCenter.lat, mainMapCenter.lng], { radius: 3, color: '#fff', weight: 1, fillColor: '#155bd0', fillOpacity: 1, interactive: false }).addTo(mini);
        }
    }, [amap, collapsed, dark, mainMapCenter.lat, mainMapCenter.lng, mainMapBounds]);
    const content=<aside className={`china-mini-map${collapsed ? ' is-collapsed' : ''}`} aria-label="全国概览" data-center={`${mainMapCenter.lat.toFixed(4)},${mainMapCenter.lng.toFixed(4)}`}>
  <button type="button" className="china-mini-map-header" aria-label={collapsed ? '展开全国概览' : '收起全国概览'} aria-expanded={!collapsed} onClick={() => setCollapsed(v => !v)}>全国概览 <span aria-hidden="true">{collapsed ? '＋' : '−'}</span></button>
  {!collapsed && <div ref={container} className="china-mini-map-canvas" role="img" aria-label="固定全国地图，点击位置跳转主地图"/>}
    </aside>;
    // Escape the main-map stacking context so mobile sheets cannot cover the overview.
    return typeof document==='undefined'?content:createPortal(content,document.querySelector('.workspace')??document.body);
}
