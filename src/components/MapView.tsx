import { useEffect, useRef, useState, type ReactNode } from "react";
import type mapboxgl from "mapbox-gl";
import type { Coordinates, Landmark, TravelMode } from "@/lib/types";
import { categoryColorVar } from "./CategoryBadge";
import { cn } from "@/lib/utils";

// mapbox-gl is loaded dynamically inside useEffect so it never runs on the server.
// CSS is imported globally in styles.css.

type MapboxGL = typeof mapboxgl;

const SKOPJE_CENTER: [number, number] = [21.4318, 41.9968];
const ROUTE_SOURCE = "route-source";
const ROUTE_LAYER = "route-layer";

export interface MapPin {
  landmark: Landmark;
  order?: number;
  dim?: boolean;
  color?: string;   // overrides the category color (used by PinGroup system)
}

interface MapViewProps {
  pins: MapPin[];
  routeIds?: string[];
  travelMode?: TravelMode;
  userLocation?: Coordinates;
  selectedId?: string;
  onPinClick?: (id: string) => void;
  className?: string;
  children?: ReactNode;
}

function makePinEl(color: string, order?: number, dim?: boolean): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.style.cssText = `
    display:flex;flex-direction:column;align-items:center;
    background:none;border:none;padding:0;cursor:pointer;
    opacity:${dim ? 0.5 : 1};
    transform-origin:bottom center;
    transition:transform 0.15s,opacity 0.15s;
  `;
  const circle = document.createElement("div");
  circle.style.cssText = `
    width:36px;height:36px;border-radius:50%;
    background:${color};border:2.5px solid white;
    box-shadow:0 4px 12px rgba(0,0,0,0.28);
    display:flex;align-items:center;justify-content:center;
    font-size:13px;font-weight:700;color:white;
    font-family:ui-sans-serif,system-ui,sans-serif;
  `;
  if (order != null) {
    circle.textContent = String(order);
  } else {
    const dot = document.createElement("span");
    dot.style.cssText = "width:8px;height:8px;border-radius:50%;background:white;";
    circle.appendChild(dot);
  }
  const tail = document.createElement("div");
  tail.style.cssText = `
    width:8px;height:8px;background:${color};
    transform:rotate(45deg) translateY(-4px);margin-top:-4px;
  `;
  btn.appendChild(circle);
  btn.appendChild(tail);
  return btn;
}

async function fetchDirectionsGeometry(
  coords: [number, number][],
  mode: TravelMode,
  token: string,
): Promise<GeoJSON.LineString | null> {
  if (coords.length < 2) return null;
  const profile = mode === "walking" ? "walking" : "driving";
  const coordStr = coords.map(([lng, lat]) => `${lng},${lat}`).join(";");
  try {
    const res = await fetch(
      `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordStr}?geometries=geojson&overview=full&access_token=${token}`,
    );
    const data = await res.json();
    return (data.routes?.[0]?.geometry as GeoJSON.LineString) ?? null;
  } catch {
    return null;
  }
}

export function MapView({
  pins,
  routeIds,
  travelMode = "driving",
  userLocation,
  selectedId,
  onPinClick,
  className,
  children,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mglRef = useRef<MapboxGL | null>(null);
  const markersRef = useRef<Map<string, { marker: mapboxgl.Marker; el: HTMLButtonElement; order?: number; color: string }>>(new Map());
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const savedViewRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const onPinClickRef = useRef(onPinClick);
  useEffect(() => { onPinClickRef.current = onPinClick; }, [onPinClick]);

  // ── Init map ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let destroyed = false;
    (async () => {
      const { default: mgl } = await import("mapbox-gl");
      if (destroyed || !containerRef.current || mapRef.current) return;
      mgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN as string;
      mglRef.current = mgl;
      const map = new mgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/light-v11",
        center: SKOPJE_CENTER,
        zoom: 13,
        attributionControl: false,
      });
      map.addControl(new mgl.AttributionControl({ compact: true }), "bottom-left");
      mapRef.current = map;
      map.once("load", () => { map.resize(); if (!destroyed) setMapReady(true); });
    })();
    return () => {
      destroyed = true;
      mapRef.current?.remove();
      mapRef.current = null;
      mglRef.current = null;
      markersRef.current.forEach(({ marker }) => marker.remove());
      markersRef.current.clear();
      userMarkerRef.current?.remove();
      setMapReady(false);
    };
  }, []);

  // ── Sync markers ──────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const mgl = mglRef.current;
    if (!mapReady || !map || !mgl) return;
    const newIds = new Set(pins.map((p) => p.landmark.id));
    for (const id of markersRef.current.keys()) {
      if (!newIds.has(id)) { markersRef.current.get(id)!.marker.remove(); markersRef.current.delete(id); }
    }
    for (const { landmark, order, dim, color: pinColor } of pins) {
      const color = pinColor ?? categoryColorVar[landmark.category];
      const existing = markersRef.current.get(landmark.id);
      // If order or color changed (e.g. group pin → numbered route pin), replace the marker
      const needsRebuild = existing && (existing.order !== order || existing.color !== color);
      if (needsRebuild) {
        existing.marker.remove();
        markersRef.current.delete(landmark.id);
      }
      if (existing && !needsRebuild) {
        existing.el.style.opacity = dim ? "0.5" : "1";
      } else {
        const el = makePinEl(color, order, dim);
        el.addEventListener("click", () => onPinClickRef.current?.(landmark.id));
        const marker = new mgl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([landmark.coordinates.lng, landmark.coordinates.lat])
          .addTo(map);
        markersRef.current.set(landmark.id, { marker, el, order, color });
      }
    }
  }, [mapReady, pins]);

  // ── User location marker ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const mgl = mglRef.current;
    userMarkerRef.current?.remove();
    if (!mapReady || !map || !mgl || !userLocation) return;
    const el = document.createElement("div");
    el.style.cssText = `
      width:16px;height:16px;border-radius:50%;
      background:oklch(0.55 0.09 155);border:2.5px solid white;
      box-shadow:0 0 0 6px oklch(0.55 0.09 155 / 0.25);
    `;
    userMarkerRef.current = new mgl.Marker({ element: el })
      .setLngLat([userLocation.lng, userLocation.lat])
      .addTo(map);
  }, [mapReady, userLocation]);

  // ── Route line + auto-fit bounds ──────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const mgl = mglRef.current;
    if (!mapReady || !map || !mgl || !routeIds?.length) return;

    let cancelled = false;

    const orderedCoords: [number, number][] = routeIds
      .map((id) => pins.find((p) => p.landmark.id === id))
      .filter(Boolean)
      .map((p) => [p!.landmark.coordinates.lng, p!.landmark.coordinates.lat]);

    if (orderedCoords.length < 2) return;

    // Fit map to show all stops
    const bounds = orderedCoords.reduce(
      (b, lngLat) => b.extend(lngLat),
      new mgl.LngLatBounds(orderedCoords[0], orderedCoords[0]),
    );
    map.fitBounds(bounds, { padding: 80, maxZoom: 15, duration: 800 });

    // Fetch real road geometry, fall back to straight line
    (async () => {
      const token = import.meta.env.VITE_MAPBOX_TOKEN as string;
      const geometry: GeoJSON.LineString =
        (await fetchDirectionsGeometry(orderedCoords, travelMode, token)) ?? {
          type: "LineString",
          coordinates: orderedCoords,
        };

      if (cancelled) return;

      const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
        type: "Feature", properties: {}, geometry,
      };

      if (map.getSource(ROUTE_SOURCE)) {
        (map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource).setData(geojson);
      } else {
        map.addSource(ROUTE_SOURCE, { type: "geojson", data: geojson });
        map.addLayer({
          id: ROUTE_LAYER,
          type: "line",
          source: ROUTE_SOURCE,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#c2714f", "line-width": 3.5, "line-opacity": 0.85 },
        });
      }
    })();

    return () => { cancelled = true; };
  }, [mapReady, routeIds, pins, travelMode]);

  // ── Fly to selected pin; restore original view on close ───────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (!selectedId) {
      if (savedViewRef.current) {
        map.easeTo({ ...savedViewRef.current, duration: 350 });
        savedViewRef.current = null;
      }
      // map.resize() is a no-op when container dimensions haven't changed.
      // jumpTo the exact current view instead — same as what a drag does internally:
      // forces Mapbox to re-run its full render loop and reposition all markers.
      const t = setTimeout(() => {
        map.jumpTo({
          center: map.getCenter(),
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        });
      }, 50);
      return () => clearTimeout(t);
    }

    const pin = pins.find((p) => p.landmark.id === selectedId);
    if (!pin) return;
    const { lng, lat } = pin.landmark.coordinates;
    const bounds = map.getBounds();

    if (bounds && !bounds.contains([lng, lat])) {
      // Pin is off-screen — save current view, then fly to pin
      savedViewRef.current = {
        center: map.getCenter().toArray() as [number, number],
        zoom: map.getZoom(),
      };
      map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 14), duration: 400 });
    }
    // Pin is already visible — no movement needed
  }, [mapReady, selectedId, pins]);

  // ── Scale selected marker ─────────────────────────────────────────────────
  useEffect(() => {
    for (const [id, { el }] of markersRef.current) {
      el.style.transform = id === selectedId ? "scale(1.15)" : "scale(1)";
      el.style.zIndex = id === selectedId ? "10" : "1";
    }
  }, [selectedId]);

  return (
    <div ref={containerRef} className={cn("relative overflow-hidden", className)}>
      {children}
    </div>
  );
}
