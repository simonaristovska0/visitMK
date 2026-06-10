# VisitMK — Refactor Plan

## Overview

Merge the current `/explore` and `/` (plan) routes into a single unified view.
The new view is a split-screen: a live Mapbox map on the left and an LLM chat panel on the right.
The user drives the entire experience through the chat — asking for places, building a tour, or manually assembling a route via drag-and-drop.

---

## 1. New Unified View Layout

### Route
Remove `/explore` and `/` as separate routes.
Replace both with a single route: `/` (home).

### Desktop split (≥ md breakpoint)
```
┌──────────────────────────────┬─────────────────────────┐
│                              │                         │
│                              │   Chat panel            │
│       Mapbox map             │   (messages + input)    │
│       (pins, route, user)    │                         │
│                              │                         │
│  [category chips — bottom]   │                         │
└──────────────────────────────┴─────────────────────────┘
```
- Map: `flex-1`, full height
- Chat panel: fixed width ~420px, full height, scrollable messages

### Mobile (< md)
- Map takes top ~55% of screen
- Chat panel slides up from bottom as a drawer
- A small drag handle lets the user collapse/expand the chat

---

## 2. Chat Interface

### Visual design
- Standard chat UI: user messages right-aligned, AI messages left-aligned with a bot avatar
- Suggestion chips when chat is empty: "Top restaurants near me", "Best landmarks", "Plan my day"
- Typing indicator (3 bouncing dots) while the LLM is responding
- Input bar pinned at the bottom of the chat panel

### Behaviour
- Chat is **stateful** — LLM keeps conversation history for the session
- Every LLM response can trigger a **map action** (add pins, draw a route) via tool calls
- User can type anything: casual questions, place requests, tour requests

### Message types
| Type | Description |
|---|---|
| `text` | Plain LLM response, shown as a chat bubble |
| `places_added` | LLM called a Places tool — map updates, summary card in chat ("Found 8 restaurants") |
| `route_created` | LLM built a tour — route on map, tour summary card in chat |
| `error` | API failure shown inline |

---

## 3. Map Behaviour

### Pin layers (PinGroups)
- Each chat action that adds places creates a named **PinGroup** (e.g. "Restaurants", "Museums")
- Each group gets its own colour so pins from different queries are visually distinct
- Groups stack — the map can show restaurants AND landmarks at the same time

### Route overlay
When a tour is generated, a polyline is drawn with numbered badges on stop pins (already in MapView).

### User location
Use `navigator.geolocation.getCurrentPosition()` on mount.
Fall back to Skopje center `{ lat: 41.9973, lng: 21.428 }` if permission is denied.

---

## 4. MCP Tools — Full Definitions

All tools run **server-side only**. The API key never reaches the browser.
The LLM (Groq llama-3.3-70b-versatile) receives tool schemas, generates a call, the server executes it, feeds the result back to the LLM, and repeats until the LLM produces a plain-text response.

### Tool 1 — `search_places_nearby`
**Trigger:** User asks for a category of place near a location.
Examples: "top restaurants near me", "museums near the old bazaar", "ATMs nearby"

**Schema:**
```typescript
{
  included_types: string[]      // e.g. ["restaurant"], ["museum","art_gallery"]
  latitude: number
  longitude: number
  radius_meters: number         // 500=spot, 2000=neighbourhood, 5000=center, 15000=city
  max_results: number           // 1–20, default 10
  rank_by: "POPULARITY" | "DISTANCE"
}
```

**API call:** `POST /v1/places:searchNearby`
**Field mask (search):**
```
places.id, places.displayName, places.primaryType, places.primaryTypeDisplayName,
places.location, places.rating, places.userRatingCount, places.priceLevel,
places.businessStatus, places.currentOpeningHours, places.regularOpeningHours,
places.shortFormattedAddress, places.editorialSummary, places.photos,
places.nationalPhoneNumber, places.websiteUri, places.googleMapsUri,
places.dineIn, places.takeout, places.delivery, places.reservable,
places.outdoorSeating, places.liveMusic, places.goodForChildren,
places.allowsDogs, places.servesVegetarianFood, places.servesBeer,
places.servesWine, places.servesCoffee, places.goodForGroups,
places.paymentOptions, places.accessibilityOptions
```

**Map effect:** Calls `addPinGroup(label, landmarks[])` → new group + chip appears.

---

### Tool 2 — `search_places_by_text`
**Trigger:** User describes a place rather than naming a category.
Examples: "traditional Macedonian tavern", "rooftop bar", "quiet cafe with wifi", "vegan food"

**Schema:**
```typescript
{
  query: string           // e.g. "rooftop bar with view of Skopje"
  latitude: number
  longitude: number
  radius_meters: number   // soft bias
  max_results: number     // 1–20, default 8
}
```

**API call:** `POST /v1/places:searchText`
**Field mask:** Same as Tool 1.
**Map effect:** Same as Tool 1.

---

### Tool 3 — `get_place_details`
**Trigger:** User asks specific info about a place already on the map.
Examples: "is this wheelchair accessible?", "what time does it close?", "does it accept cards?"

**Schema:**
```typescript
{ place_id: string }   // Google Place ID, e.g. "ChIJ..."
```

**API call:** `GET /v1/places/{placeId}`
**Field mask (full — everything):**
```
id, displayName, primaryType, primaryTypeDisplayName, types, location,
formattedAddress, shortFormattedAddress, googleMapsUri,
rating, userRatingCount, priceLevel, businessStatus,
currentOpeningHours, regularOpeningHours,
currentSecondaryOpeningHours, regularSecondaryOpeningHours, utcOffsetMinutes,
nationalPhoneNumber, internationalPhoneNumber, websiteUri,
editorialSummary, photos, reviews,
dineIn, takeout, delivery, reservable,
servesBreakfast, servesLunch, servesDinner, servesBrunch,
servesBeer, servesWine, servesCocktails, servesCoffee, servesDessert, servesVegetarianFood,
outdoorSeating, liveMusic, goodForChildren, allowsDogs, restroom, goodForGroups, menuForChildren,
paymentOptions, parkingOptions, accessibilityOptions, attributions
```

**Map effect:** None — LLM uses result to answer a question in the chat.

---

### Tool 4 — `check_opening_status`
**Trigger:** During tour planning — verify a stop will be open at the planned visit time.
Should be called for every proposed stop in a tour.

**Schema:**
```typescript
{
  place_id: string
  check_datetime_iso: string | null   // e.g. "2026-06-10T14:00:00", null = now
}
```

**API call:** `GET /v1/places/{placeId}` with minimal mask: `id,displayName,businessStatus,currentOpeningHours`

**Returns:**
```typescript
{
  place_id: string
  place_name: string
  is_open_now: boolean
  closes_at: string | null         // e.g. "10:00 PM" if currently open
  opens_at: string | null          // e.g. "09:00 AM" if currently closed
  next_open_time: string | null    // RFC3339 from Google
  next_close_time: string | null   // RFC3339 from Google
  today_hours: string
  status: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY"
  warning: string | null           // e.g. "Closes in 45 minutes"
}
```

**Map effect:** None — used by LLM to filter out closed stops before building route.

---

### Tool 5 — `build_route`
**Trigger:** User asks to plan a tour, or clicks "Calculate route" in manual builder.
Wraps the existing `itinerary.server.ts` Mapbox pipeline.

**Schema:**
```typescript
{
  waypoints: Array<{ place_id: string; coordinates: { lat: number; lng: number }; category: string }>
  travel_mode: "walking" | "driving"
  optimize_order: boolean   // true = Mapbox Matrix API finds best order
}
```

**API calls:** Mapbox Matrix API + Mapbox Directions API (already implemented in `itinerary.server.ts`)

**Returns:** Full `Itinerary` object (stops with travel legs, total time, total distance).
**Map effect:** Calls `setRoute(itinerary)` → polyline + numbered pins drawn on map.

---

### Tool 6 — `find_known_area`
**Trigger:** User mentions a named area of Skopje.
Examples: "near the old bazaar", "in Karposh", "around City Square"

**Schema:**
```typescript
{ area_name: string }   // e.g. "old bazaar", "city center", "karposh"
```

**API call:** None — pure static lookup, no key needed.

**Lookup table:**
```typescript
const SKOPJE_AREAS = {
  "old bazaar":  { lat: 42.001,  lng: 21.435, radius: 1500 },
  "carsija":     { lat: 42.001,  lng: 21.435, radius: 1500 },
  "city center": { lat: 41.9973, lng: 21.428, radius: 2000 },
  "city square": { lat: 41.9962, lng: 21.4314, radius: 1000 },
  "karposh":     { lat: 41.998,  lng: 21.396, radius: 3000 },
  "aerodrom":    { lat: 41.973,  lng: 21.451, radius: 3000 },
  "gazi baba":   { lat: 41.994,  lng: 21.497, radius: 3000 },
  "chair":       { lat: 42.010,  lng: 21.450, radius: 2000 },
  "vodno":       { lat: 41.959,  lng: 21.408, radius: 4000 },
  "matka":       { lat: 41.943,  lng: 21.313, radius: 5000 },
  "skopje":      { lat: 41.9973, lng: 21.428, radius: 15000 },
}
```

**Returns:** `{ area_name, latitude, longitude, radius_suggestion_meters }`
**Map effect:** None — LLM uses coordinates as input for Tool 1 or Tool 2.

---

### Tool 7 — `get_weather`
**Trigger:** During tour planning, or when user asks about weather.
API: `wttr.in` — completely free, no key required.

**Schema:**
```typescript
{ latitude: number; longitude: number }
```

**API call:** `GET https://wttr.in/{lat},{lng}?format=j1`

**Returns:**
```typescript
{
  temp_c: number
  feels_like_c: number
  condition: string       // e.g. "Sunny", "Partly cloudy", "Light rain"
  humidity_percent: number
  wind_kmh: number
  uv_index: number
  is_raining: boolean
  recommendation: string  // e.g. "Great day for outdoor sightseeing"
}
```

---

### Searchable place types reference (for LLM system prompt)

**Food & Drink:**
`restaurant, fast_food_restaurant, pizza_restaurant, italian_restaurant, greek_restaurant,
cafe, coffee_shop, tea_house, bakery, ice_cream_shop, bar, wine_bar, cocktail_bar,
sports_bar, pub, night_club`

**Tourism & Culture:**
`tourist_attraction, historical_landmark, monument, museum, art_gallery, cultural_center,
church, mosque, synagogue, hindu_temple, place_of_worship, castle, fort, palace`

**Nature & Outdoors:**
`park, botanical_garden, zoo, aquarium, amusement_park, hiking_area, observation_deck`

**Shopping:**
`shopping_mall, department_store, market, souvenir_shop, gift_shop, clothing_store,
jewelry_store, book_store, electronics_store, antique_shop`

**Services (tourist-relevant):**
`hotel, hostel, bank, atm, pharmacy, hospital, spa, car_rental, parking`

---

### What the LLM can do with these tools

| User says | Tools called | Map effect |
|---|---|---|
| "Top restaurants near me" | `search_places_nearby` types=["restaurant"] | "Restaurants" group added |
| "Italian pizza places" | `search_places_by_text` query="italian pizza skopje" | "Pizza" group added |
| "Museums near the old bazaar" | `find_known_area` → `search_places_nearby` | "Museums" group added |
| "Rooftop bars" | `search_places_by_text` query="rooftop bar skopje" | "Bars" group added |
| "Shopping in Aerodrom" | `find_known_area` → `search_places_nearby` types=["shopping_mall"] | "Shopping" group added |
| "Vegan restaurants" | `search_places_by_text` query="vegan restaurant" | "Vegan" group added |
| "ATMs near me" | `search_places_nearby` types=["atm"] rank=DISTANCE | "ATMs" group added |
| "What time does this close?" | `check_opening_status` | Text answer in chat |
| "Does it accept cards?" | `get_place_details` | Text answer in chat |
| "Wheelchair accessible cafés" | `search_places_nearby` types=["cafe"] | "Cafés" group, LLM filters by accessibilityOptions |
| "Plan me a morning tour" | `find_known_area` + `search_places_nearby` + `check_opening_status`×N + `get_weather` + `build_route` | Route drawn + tour card in chat |

---

## 5. Dynamic Category Chips

### State shape
```typescript
type PinGroup = {
  id: string            // unique per chat action, e.g. "msg_3_restaurants"
  label: string         // chip label, e.g. "Restaurants"
  color: string         // hex pin colour for this group
  landmarks: Landmark[]
  visible: boolean      // toggled by chip tap
}

type MapState = {
  groups: PinGroup[]
  route: Itinerary | null
  userLocation: Coordinates | null
}
```

### Behaviour
- "All" chip always present — toggles all groups simultaneously
- Each group chip has a label and an × to remove that group
- Tapping a chip toggles `visible` — pins hide/show without losing the data
- Clicking × calls `removeGroup(id)` — pins gone, chip gone

---

## 6. Tour Planning Flow

1. User: "Plan me a half-day tour of the Old Bazaar area"
2. LLM calls `find_known_area("old bazaar")` → gets coordinates
3. LLM calls `search_places_nearby` with those coordinates → gets ~15 candidates
4. LLM calls `get_weather` → checks if outdoor-heavy tour is sensible
5. LLM calls `check_opening_status` for each candidate → filters closed places
6. LLM calls `build_route` with the filtered, selected stops → gets `Itinerary`
7. LLM returns a text summary + the `Itinerary` object
8. Frontend renders `TourSummaryCard` in chat + route polyline on map

### Visit duration defaults per category
| Category | Visit time |
|---|---|
| landmark | 30 min |
| culture | 60 min |
| food | 75 min |
| cafe | 45 min |
| outdoors | 90 min |
| shopping | 45 min |

---

## 7. "Create" Button — Manual Route Builder

### UI
- "Create route" button floats at bottom-right of the map
- Opens a panel (replaces chat on desktop, full sheet on mobile)

```
┌───────────────────────────┐
│  Create your route        │
│  ─────────────────────    │
│  1. Stone Bridge     [×]  │  ← drag handle on left
│  2. Old Bazaar       [×]  │
│  + Drag a pin here        │  ← drop zone
│                           │
│  Travel mode: [Walk][Car] │
│  [Calculate route]        │
└───────────────────────────┘
```

### Drag & drop
- All visible map pins are draggable (drag source via `@dnd-kit/core`)
- Drop zone is the route builder list
- List items are reorderable via `@dnd-kit/sortable`
- Pins added to the list get numbered badges; removed pins lose the badge

### After "Calculate route"
- Calls `build_route` with the ordered waypoints
- Route polyline + numbered pins drawn on map
- Summary row: total time, total distance

---

## 8. New Files to Create

| File | Purpose |
|---|---|
| `src/lib/mcp/places-mcp.ts` | All 7 tool schemas + server-side executors |
| `src/lib/api/weather.server.ts` | wttr.in fetch + response parsing |
| `src/lib/api/weather.functions.ts` | TanStack server fn wrapper |
| `src/hooks/useMapState.ts` | PinGroup[] state: add, remove, toggle, setRoute |
| `src/hooks/useChat.ts` | Chat messages, send, tool result handling |
| `src/components/UnifiedView.tsx` | Full unified view (map + chat wired together) |
| `src/components/ChatPanel.tsx` | Chat UI: messages list, input, suggestion chips |
| `src/components/PlacesResultCard.tsx` | Chat card: "Found 8 restaurants" with thumbnail grid |
| `src/components/TourSummaryCard.tsx` | Chat card: ordered stop list + time/distance |
| `src/components/RouteBuilder.tsx` | Drag-and-drop manual route builder panel |

---

## 9. Files to Modify

| File | Change |
|---|---|
| `src/lib/types.ts` | Add `PinGroup`, `MapState`, `ChatMessage`, `PlaceAttributes` types |
| `src/lib/api/ai.server.ts` | Rewrite: tool-calling loop (send → tool call → execute → feed back → repeat) |
| `src/lib/api/ai.functions.ts` | Add `sendUnifiedChatMessage` server fn |
| `src/routes/index.tsx` | Swap `<PlanView>` for `<UnifiedView>` |
| `src/components/AppNav.tsx` | Remove "Explore" item (keep Plan/Saved/Profile) |

---

## 10. Files to Keep Unchanged

| File | Reused by |
|---|---|
| `src/components/MapView.tsx` | UnifiedView |
| `src/components/LandmarkDetail.tsx` | UnifiedView (pin tap → same detail sheet) |
| `src/components/AskAIChat.tsx` | LandmarkDetail (per-place chat) |
| `src/lib/api/places.server.ts` | Wrapped by MCP tool executors |
| `src/lib/api/itinerary.server.ts` | Wrapped by `build_route` tool |
| `src/lib/api/wikipedia.server.ts` | Unchanged |
| `src/lib/supabase.ts` | Saved places unchanged |
| `src/lib/auth.tsx` | Unchanged |

---

## 11. Implementation Steps (ordered)

### Phase 1 — Foundation
1. Install `@dnd-kit/core` and `@dnd-kit/sortable`
2. Extend `src/lib/types.ts` with `PinGroup`, `MapState`, `ChatMessage`, `PlaceAttributes`
3. Create `src/hooks/useMapState.ts`
4. Create `src/hooks/useChat.ts`

### Phase 2 — MCP & AI backend
5. Create `src/lib/mcp/places-mcp.ts` — tool schemas + executors for all 7 tools
6. Create `src/lib/api/weather.server.ts` + `weather.functions.ts`
7. Rewrite `src/lib/api/ai.server.ts` — tool-calling loop
8. Add `sendUnifiedChatMessage` to `src/lib/api/ai.functions.ts`

### Phase 3 — UI components
9. Create `src/components/ChatPanel.tsx`
10. Create `src/components/PlacesResultCard.tsx`
11. Create `src/components/TourSummaryCard.tsx`
12. Create `src/components/RouteBuilder.tsx`

### Phase 4 — UnifiedView assembly
13. Create `src/components/UnifiedView.tsx` — wires map + chat + route builder
14. Update `src/routes/index.tsx`
15. Update `src/components/AppNav.tsx`

### Phase 5 — Cleanup
16. Delete `src/routes/explore.tsx`
17. Delete `src/components/PlanView.tsx` and `src/components/ExploreView.tsx`
