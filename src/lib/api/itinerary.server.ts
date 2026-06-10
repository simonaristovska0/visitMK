import type { Category, Coordinates, Itinerary, RouteStop, TravelLeg, TravelMode } from "../types";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ItineraryWaypoint {
  id: string;
  coordinates: Coordinates;
  category: Category;
  visitDurationMinutes?: number; // overrides STOP_DURATION[category] when provided
}

interface MatrixResponse {
  durations: (number | null)[][];
  distances: (number | null)[][];
}

interface DirectionsLeg {
  distance: number; // meters
  duration: number; // seconds
}

interface DirectionsResponse {
  routes: Array<{
    distance: number;
    duration: number;
    legs: DirectionsLeg[];
  }>;
}

// ── Constants ──────────────────────────────────────────────────────────────

const MAPBOX_BASE = "https://api.mapbox.com";

const STOP_DURATION: Record<Category, number> = {
  outdoors: 90,
  food: 75,
  cafe: 45,
  culture: 60,
  shopping: 45,
  landmark: 30,
};

// ── Helpers ────────────────────────────────────────────────────────────────

function profile(mode: TravelMode): string {
  return mode === "walking" ? "walking" : "driving";
}

function coordStr(points: Coordinates[]): string {
  return points.map((p) => `${p.lng},${p.lat}`).join(";");
}

// Straight-line distance in meters (haversine)
function straightLine(a: Coordinates, b: Coordinates): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// Greedy nearest-neighbour ordering using a duration matrix.
// Null cells (unreachable) are treated as Infinity.
function greedyOrder(durations: (number | null)[][]): number[] {
  const n = durations.length;
  const visited = new Set<number>([0]);
  const order = [0];
  while (order.length < n) {
    const last = order[order.length - 1];
    let best = -1;
    let bestCost = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited.has(j)) {
        const cost = durations[last][j] ?? Infinity;
        if (cost < bestCost) {
          best = j;
          bestCost = cost;
        }
      }
    }
    if (best === -1) break;
    visited.add(best);
    order.push(best);
  }
  return order;
}

// ── Mapbox API calls ────────────────────────────────────────────────────────

async function fetchMatrix(
  coords: Coordinates[],
  mode: TravelMode,
  token: string,
): Promise<MatrixResponse | null> {
  try {
    const url =
      `${MAPBOX_BASE}/directions-matrix/v1/mapbox/${profile(mode)}/` +
      `${coordStr(coords)}?annotations=duration,distance&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as MatrixResponse;
  } catch {
    return null;
  }
}

async function fetchDirections(
  coords: Coordinates[],
  mode: TravelMode,
  token: string,
): Promise<DirectionsResponse | null> {
  if (coords.length < 2) return null;
  try {
    const url =
      `${MAPBOX_BASE}/directions/v5/mapbox/${profile(mode)}/` +
      `${coordStr(coords)}?geometries=geojson&overview=full&steps=false&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as DirectionsResponse;
  } catch {
    return null;
  }
}

// ── Public export ──────────────────────────────────────────────────────────

/**
 * Builds an optimised itinerary:
 *  1. Mapbox Matrix API → travel-time matrix
 *  2. Greedy nearest-neighbour → ordered stops
 *  3. Mapbox Directions API → real leg distances + durations
 *
 * Falls back gracefully: straight-line order if Matrix fails,
 * estimated legs if Directions fails.
 */
export async function buildItinerary(
  waypoints: ItineraryWaypoint[],
  travelMode: TravelMode,
  wish: string,
  token: string,
): Promise<Itinerary> {
  if (waypoints.length === 0) throw new Error("No waypoints provided");

  const coords = waypoints.map((w) => w.coordinates);

  // ── Step 1: Matrix API → optimised order ────────────────────────────────
  let orderedIdx: number[];
  const matrix = waypoints.length > 1 ? await fetchMatrix(coords, travelMode, token) : null;

  if (matrix?.durations) {
    orderedIdx = greedyOrder(matrix.durations);
  } else {
    // Fallback: keep input order (caller should sort by proximity)
    orderedIdx = waypoints.map((_, i) => i);
  }

  const ordered = orderedIdx.map((i) => waypoints[i]);
  const orderedCoords = orderedIdx.map((i) => coords[i]);

  // ── Step 2: Directions API → real legs ──────────────────────────────────
  const directions =
    ordered.length > 1 ? await fetchDirections(orderedCoords, travelMode, token) : null;

  const legs: DirectionsLeg[] = directions?.routes?.[0]?.legs ?? [];

  // ── Step 3: Assemble stops ───────────────────────────────────────────────
  const stops: RouteStop[] = ordered.map((wp, i) => {
    const leg = legs[i - 1];
    let travelFromPrevious: TravelLeg | undefined;
    if (i > 0) {
      if (leg) {
        travelFromPrevious = {
          distanceKm: Math.round(leg.distance / 100) / 10,
          durationMinutes: Math.max(1, Math.round(leg.duration / 60)),
          mode: travelMode,
        };
      } else {
        // Straight-line fallback
        const dist = straightLine(orderedCoords[i - 1], orderedCoords[i]);
        const speed = travelMode === "walking" ? 1.4 : 10; // m/s
        travelFromPrevious = {
          distanceKm: Math.round(dist / 100) / 10,
          durationMinutes: Math.max(1, Math.round(dist / speed / 60)),
          mode: travelMode,
        };
      }
    }
    return {
      landmarkId: wp.id,
      order: i + 1,
      durationMinutes: wp.visitDurationMinutes ?? STOP_DURATION[wp.category],
      ...(travelFromPrevious ? { travelFromPrevious } : {}),
    };
  });

  // ── Step 4: Totals ────────────────────────────────────────────────────────
  const totalVisitMinutes = stops.reduce((s, st) => s + st.durationMinutes, 0);
  const totalTravelMinutes = stops.reduce(
    (s, st) => s + (st.travelFromPrevious?.durationMinutes ?? 0),
    0,
  );
  const totalDistanceKm =
    directions?.routes?.[0]
      ? Math.round(directions.routes[0].distance / 100) / 10
      : stops.reduce((s, st) => s + (st.travelFromPrevious?.distanceKm ?? 0), 0);

  return {
    id: `itin_${Date.now()}`,
    wish,
    stops,
    totalDurationMinutes: totalVisitMinutes + totalTravelMinutes,
    totalDistanceKm,
    travelMode,
  };
}
