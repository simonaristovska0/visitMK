# Google Places API (New) — MCP Tools Design

## What the Google Places API (New) actually offers

The Google Places API (New) has three main endpoints and one media endpoint.
Below is everything each one can return, grouped by category.
Fields marked ✅ are already being fetched in `places.server.ts`.
Fields marked 🆕 are available but not yet used — candidates for MCP tools.

---

### Endpoint A: `POST /v1/places:searchNearby`
Search by place **type** + geographic circle. Best for category-based queries.
Returns up to 20 results per call.

### Endpoint B: `POST /v1/places:searchText`
Search by **free text** with an optional location bias. Best for specific queries.
Returns up to 20 results per call.

### Endpoint C: `GET /v1/places/{placeId}`
Fetch **full details** for one specific place by its ID.
Only endpoint that returns all fields (some fields like `accessibilityOptions` are only available here).

### Endpoint D: `POST /v1/places:autocomplete`
Suggest place names as the user types. Returns IDs + display strings.
Useful for when the user types a specific known place name in the chat.

### Endpoint E: `GET /v1/{photoName}/media`
Resolve a photo reference name into an actual CDN image URL. ✅ Already used.

---

## All available fields

### Identity & Location
| Field | Status | Notes |
|---|---|---|
| `id` | ✅ | Google's internal place ID, e.g. `"ChIJ..."` |
| `displayName.text` | ✅ | Human-readable name |
| `primaryType` | 🆕 | Single primary Google type, e.g. `"restaurant"` |
| `primaryTypeDisplayName.text` | 🆕 | Human-readable type, e.g. `"Italian Restaurant"` |
| `types` | 🆕 | All type tags, e.g. `["restaurant", "food", "establishment"]` |
| `location` | ✅ | `{ latitude, longitude }` |
| `formattedAddress` | 🆕 | Full address string |
| `shortFormattedAddress` | ✅ | Short address, e.g. `"Ploštad Makedonija"` |
| `googleMapsUri` | 🆕 | Direct Google Maps link for the place |
| `plusCode` | 🆕 | Open Location Code (useful offline) |
| `utcOffsetMinutes` | 🆕 | Timezone offset (important for accurate open/close times) |

### Ratings & Pricing
| Field | Status | Notes |
|---|---|---|
| `rating` | ✅ | 1.0–5.0 star average |
| `userRatingCount` | ✅ | Number of ratings |
| `priceLevel` | ✅ | `INEXPENSIVE / MODERATE / EXPENSIVE / VERY_EXPENSIVE` |

### Business Status
| Field | Status | Notes |
|---|---|---|
| `businessStatus` | ✅ | `OPERATIONAL / CLOSED_TEMPORARILY / CLOSED_PERMANENTLY` |

### Opening Hours
| Field | Status | Notes |
|---|---|---|
| `currentOpeningHours.openNow` | ✅ | Is it open right now (boolean) |
| `currentOpeningHours.periods` | 🆕 | Structured open/close periods for the current week |
| `currentOpeningHours.weekdayDescriptions` | ✅ | `["Monday: 9:00 AM – 10:00 PM", ...]` |
| `currentOpeningHours.nextOpenTime` | 🆕 | **When does it next open** (RFC3339 timestamp) |
| `currentOpeningHours.nextCloseTime` | 🆕 | **When does it next close** (RFC3339 timestamp) |
| `regularOpeningHours.weekdayDescriptions` | ✅ | Standard weekly hours (not holiday-adjusted) |
| `regularOpeningHours.periods` | 🆕 | Structured periods for standard hours |
| `currentSecondaryOpeningHours` | 🆕 | Special hours: kitchen, bar, delivery, takeout, drive-through |
| `regularSecondaryOpeningHours` | 🆕 | Same but for standard schedule |

> `nextOpenTime` and `nextCloseTime` are **critical for tour planning** — they let the LLM know "this museum closes at 17:00, so if you visit it at 16:30 you only have 30 minutes".

### Contact
| Field | Status | Notes |
|---|---|---|
| `nationalPhoneNumber` | ✅ | Local format, e.g. `"02 123 4567"` |
| `internationalPhoneNumber` | 🆕 | With country code, e.g. `"+389 2 123 4567"` |
| `websiteUri` | ✅ | Official website |

### Content
| Field | Status | Notes |
|---|---|---|
| `editorialSummary.text` | ✅ | Short editorial description |
| `photos` | ✅ | Array of photo references (up to 10) |
| `reviews` | ✅ | Up to 5 user reviews with text + rating |
| `generativeSummary` | 🆕 | **AI-generated description** (newer field, may require billing tier) |
| `highlights` | 🆕 | **Short highlight tags** about what makes the place special |
| `attributions` | 🆕 | Required attributions for displaying content |

### Dining & Food Specifics (food/cafe only)
| Field | Status | Notes |
|---|---|---|
| `dineIn` | 🆕 | Has seating inside |
| `takeout` | 🆕 | Offers takeout/to-go |
| `delivery` | 🆕 | Offers delivery |
| `reservable` | 🆕 | Can you book a table online |
| `servesBreakfast` | 🆕 | Opens for breakfast |
| `servesLunch` | 🆕 | Open for lunch |
| `servesDinner` | 🆕 | Open for dinner |
| `servesBrunch` | 🆕 | Weekend brunch |
| `servesBeer` | 🆕 | Has beer on menu |
| `servesWine` | 🆕 | Has wine on menu |
| `servesCocktails` | 🆕 | Has cocktails |
| `servesCoffee` | 🆕 | Serves coffee |
| `servesDessert` | 🆕 | Has desserts |
| `servesVegetarianFood` | 🆕 | Has vegetarian options |

### Atmosphere & Amenities
| Field | Status | Notes |
|---|---|---|
| `outdoorSeating` | 🆕 | Has terrace or patio |
| `liveMusic` | 🆕 | Has live music |
| `goodForChildren` | 🆕 | Family-friendly |
| `allowsDogs` | 🆕 | Pet-friendly |
| `restroom` | 🆕 | Has public restroom |
| `goodForGroups` | 🆕 | Suitable for large groups |
| `goodForWatchingSports` | 🆕 | Sports bar style |
| `menuForChildren` | 🆕 | Has kids menu |

### Accessibility
| Field | Status | Notes |
|---|---|---|
| `accessibilityOptions.wheelchairAccessibleEntrance` | 🆕 | Step-free entry |
| `accessibilityOptions.wheelchairAccessibleParking` | 🆕 | Accessible parking |
| `accessibilityOptions.wheelchairAccessibleRestroom` | 🆕 | Accessible restroom |
| `accessibilityOptions.wheelchairAccessibleSeating` | 🆕 | Accessible seating |

### Payment & Parking
| Field | Status | Notes |
|---|---|---|
| `paymentOptions.acceptsCreditCards` | 🆕 | Accepts card |
| `paymentOptions.acceptsDebitCards` | 🆕 | Accepts debit |
| `paymentOptions.acceptsCashOnly` | 🆕 | **Cash only** — useful to warn users |
| `paymentOptions.acceptsNfc` | 🆕 | Contactless payment |
| `parkingOptions.freeParkingLot` | 🆕 | Free parking available |
| `parkingOptions.paidParkingLot` | 🆕 | Paid parking lot |
| `parkingOptions.freeStreetParking` | 🆕 | Free street parking nearby |
| `parkingOptions.valetParking` | 🆕 | Valet available |

---

## All searchable place types

The `includedTypes` parameter in `searchNearby` accepts any of these. Currently the app uses only a fraction.

### Food & Drink
```
restaurant, fast_food_restaurant, pizza_restaurant, chinese_restaurant,
italian_restaurant, japanese_restaurant, greek_restaurant, indian_restaurant,
american_restaurant, hamburger_restaurant, sandwich_shop, breakfast_restaurant,
cafe, coffee_shop, tea_house, bakery, ice_cream_shop, dessert_shop,
bar, wine_bar, cocktail_bar, sports_bar, juice_bar, pub, night_club,
food_court, buffet_restaurant, meal_delivery, meal_takeaway
```

### Tourism & Culture
```
tourist_attraction, historical_landmark, monument, sculpture,
museum, art_gallery, cultural_center,
performing_arts_theater, comedy_club, concert_hall, opera_house,
church, mosque, synagogue, hindu_temple, buddhist_temple, place_of_worship,
castle, fort, palace
```

### Nature & Outdoors
```
park, botanical_garden, national_park, campground, hiking_area,
zoo, aquarium, wildlife_park, dog_park, beach,
amusement_park, water_park, observation_deck
```

### Shopping
```
shopping_mall, department_store, market, flea_market,
clothing_store, shoe_store, jewelry_store, book_store,
electronics_store, furniture_store, souvenir_shop, gift_shop,
art_dealer, antique_shop, hardware_store, supermarket
```

### Accommodation
```
hotel, hostel, motel, bed_and_breakfast, resort_hotel, boutique_hotel, spa
```

### Services (useful for tourists)
```
bank, atm, pharmacy, hospital, doctor, dentist,
beauty_salon, spa, gym, hair_salon, nail_salon,
car_rental, parking, gas_station
```

---

## Proposed MCP Tools

### Tool 1: `search_places_nearby`
**When the LLM should use it:** User asks for a category of place near a location.
Examples: *"top restaurants near me"*, *"museums near the old bazaar"*, *"parks in Skopje"*, *"ATMs nearby"*

```typescript
name: "search_places_nearby"
description: "Search for places of specific types within a geographic area. Use this when the
              user asks for a category of places (e.g. restaurants, museums, parks) near a location."

parameters:
  included_types: string[]
    // One or more Google place types from the allowed list.
    // Examples: ["restaurant"], ["museum", "art_gallery"], ["park", "botanical_garden"]
    // The LLM picks the correct types based on user intent.

  latitude: number
    // Center of the search area. Use user's current location, or a known area's coordinates.

  longitude: number

  radius_meters: number
    // Search radius. Suggested defaults:
    //   500  → "near this spot"
    //   2000 → "in this neighbourhood"
    //   5000 → "in the city center"
    //   15000 → "in Skopje" (whole city)

  max_results: number  // 1–20, default 10

  rank_by: "POPULARITY" | "DISTANCE"
    // POPULARITY → best-rated/most-visited first (default for discovery)
    // DISTANCE   → closest first (better for "nearest ATM" type queries)
```

**Returns:** Array of places with: id, name, category, coordinates, rating, reviewCount,
priceLevel, openNow, address, phone, website, heroImage, editorialSummary, weeklyHours,
dineIn, takeout, delivery, reservable, outdoorSeating, servesVegetarianFood,
goodForChildren, allowsDogs, paymentOptions, accessibilityOptions.

**How it updates the map:** Frontend receives the result, calls `addPinGroup()` with
`label = primaryTypeDisplayName` of the results (e.g. "Restaurants", "Museums").

---

### Tool 2: `search_places_by_text`
**When the LLM should use it:** User asks for something specific that isn't just a category.
Examples: *"traditional Macedonian tavern"*, *"rooftop bar with a view"*, *"coffee shop good for remote work"*, *"vegan food"*

```typescript
name: "search_places_by_text"
description: "Search for places using a natural language text query. Use this when the user
              describes what they want rather than naming a category — e.g. 'traditional
              Macedonian food', 'rooftop bar', 'vegan restaurant', 'quiet cafe with wifi'."

parameters:
  query: string
    // The search query exactly as the user described it, or a refined version.
    // Good: "traditional Macedonian restaurant skopje"
    // Good: "rooftop bar with view of Skopje"

  latitude: number       // location bias center
  longitude: number

  radius_meters: number  // bias radius (soft — results can be outside this)

  max_results: number    // 1–20, default 8
```

**Returns:** Same shape as `search_places_nearby`.

---

### Tool 3: `get_place_details`
**When the LLM should use it:** User asks for specific info about a place that is already on the map,
or during tour planning when detailed hours/attributes are needed.
Examples: *"is Stone Bridge wheelchair accessible?"*, *"what time does the Old Bazaar close?"*, *"does this restaurant accept credit cards?"*

```typescript
name: "get_place_details"
description: "Get complete details for a specific place by its ID. Use this when you need
              opening hours for tour planning, accessibility info, payment options, dining
              attributes, or any detail not available from search results."

parameters:
  place_id: string
    // The Google Place ID (starts with "ChIJ..." or "places/...").
    // Comes from a previous search result.
```

**Returns (everything):** All fields listed in the field table above, including:
- Full structured opening hours with `nextOpenTime` / `nextCloseTime`
- All dining attributes (dineIn, takeout, reservable, servesVegetarianFood, etc.)
- All accessibility options
- All payment and parking options
- Secondary opening hours (kitchen hours, bar hours, etc.)
- Up to 10 photos
- Up to 5 reviews
- Google Maps direct link

**Note:** This endpoint is GET `/v1/places/{placeId}` — different from the search endpoints.
The field mask can request every field at once since it's a single-place lookup.

---

### Tool 4: `check_opening_status`
**When the LLM should use it:** During tour planning, to verify a place will actually be
open when the user plans to visit. Should be called for every stop in a proposed tour.

```typescript
name: "check_opening_status"
description: "Check whether a place is currently open, and find out when it next opens or
              closes. Use this during tour planning to avoid routing to a closed venue."

parameters:
  place_id: string

  check_datetime_iso: string | null
    // ISO 8601 datetime to check, e.g. "2026-06-10T14:00:00".
    // If null, checks current time.
```

**Returns:**
```typescript
{
  place_id: string
  place_name: string
  is_open_now: boolean
  opens_at: string | null      // e.g. "09:00 AM" if currently closed
  closes_at: string | null     // e.g. "10:00 PM" if currently open
  next_open_time: string | null  // RFC3339 timestamp from Google
  next_close_time: string | null // RFC3339 timestamp from Google
  today_hours: string          // e.g. "Monday: 9:00 AM – 10:00 PM"
  status: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY"
  warning: string | null       // e.g. "Closes in 45 minutes" if visit is close to closing time
}
```

**Implementation note:** Under the hood, this calls `GET /v1/places/{placeId}` with a
minimal field mask: `id,displayName,businessStatus,currentOpeningHours`.

---

### Tool 5: `get_place_photo`
**When the LLM should use it:** Not called by LLM directly — called automatically by the
frontend when displaying place cards. Included here for completeness.

```typescript
name: "get_place_photo"
description: "Resolve a Google photo reference name into a displayable image URL."

parameters:
  photo_name: string   // e.g. "places/ChIJ.../photos/AUc..."
  max_width_px: number // default 800
```

**Returns:** `{ photo_url: string }`

**Note:** This is already implemented in `places.server.ts` as `resolvePhotoUrl()`.

---

### Tool 6: `find_known_area` (no API call — static lookup)
**When the LLM should use it:** When the user mentions a named area of Skopje and we
need its coordinates to centre the search.
Examples: *"near the old bazaar"*, *"around City Square"*, *"in Aerodrom"*, *"near Vodno"*

```typescript
name: "find_known_area"
description: "Convert a named area or neighbourhood of Skopje into GPS coordinates for
              use as a search center. Use this before calling search tools when the user
              mentions a specific area rather than 'near me'."

parameters:
  area_name: string   // e.g. "old bazaar", "city center", "karposh", "aerodrom"
```

**Returns:**
```typescript
{
  area_name: string
  latitude: number
  longitude: number
  radius_suggestion_meters: number  // suggested search radius for this area
}
```

**Implementation:** Pure static lookup — no API call, no key needed:
```typescript
const SKOPJE_AREAS = {
  "old bazaar":    { lat: 42.001,  lng: 21.435, radius: 1500 },
  "carsija":       { lat: 42.001,  lng: 21.435, radius: 1500 },
  "city center":   { lat: 41.9973, lng: 21.428, radius: 2000 },
  "city square":   { lat: 41.9962, lng: 21.4314, radius: 1000 },
  "karposh":       { lat: 41.998,  lng: 21.396, radius: 3000 },
  "aerodrom":      { lat: 41.973,  lng: 21.451, radius: 3000 },
  "gazi baba":     { lat: 41.994,  lng: 21.497, radius: 3000 },
  "chair":         { lat: 42.010,  lng: 21.450, radius: 2000 },
  "vodno":         { lat: 41.959,  lng: 21.408, radius: 4000 },
  "matka":         { lat: 41.943,  lng: 21.313, radius: 5000 },
  "skopje":        { lat: 41.9973, lng: 21.428, radius: 15000 },
}
```

---

## Field masks per tool

Each tool should request only the fields it actually needs.
Google bills per field group — requesting fewer fields = lower cost per call.

### Field mask for search tools (Tool 1 + 2)
```
places.id,
places.displayName,
places.primaryType,
places.primaryTypeDisplayName,
places.location,
places.rating,
places.userRatingCount,
places.priceLevel,
places.businessStatus,
places.currentOpeningHours,
places.regularOpeningHours,
places.shortFormattedAddress,
places.editorialSummary,
places.photos,
places.nationalPhoneNumber,
places.websiteUri,
places.googleMapsUri,
places.dineIn,
places.takeout,
places.delivery,
places.reservable,
places.outdoorSeating,
places.liveMusic,
places.goodForChildren,
places.allowsDogs,
places.servesVegetarianFood,
places.servesBeer,
places.servesWine,
places.servesCoffee,
places.goodForGroups,
places.paymentOptions,
places.accessibilityOptions
```

### Field mask for get_place_details (Tool 3) — everything
```
id,
displayName,
primaryType,
primaryTypeDisplayName,
types,
location,
formattedAddress,
shortFormattedAddress,
googleMapsUri,
rating,
userRatingCount,
priceLevel,
businessStatus,
currentOpeningHours,
regularOpeningHours,
currentSecondaryOpeningHours,
regularSecondaryOpeningHours,
utcOffsetMinutes,
nationalPhoneNumber,
internationalPhoneNumber,
websiteUri,
editorialSummary,
photos,
reviews,
dineIn,
takeout,
delivery,
reservable,
servesBreakfast,
servesLunch,
servesDinner,
servesBrunch,
servesBeer,
servesWine,
servesCocktails,
servesCoffee,
servesDessert,
servesVegetarianFood,
outdoorSeating,
liveMusic,
goodForChildren,
allowsDogs,
restroom,
goodForGroups,
menuForChildren,
paymentOptions,
parkingOptions,
accessibilityOptions,
attributions
```

### Field mask for check_opening_status (Tool 4) — minimal
```
id,
displayName,
businessStatus,
currentOpeningHours
```

---

## What the LLM will be able to answer with these tools

| User says | Tools called | Map action |
|---|---|---|
| "Show me top restaurants" | `search_places_nearby` types=["restaurant"] | Add "Restaurants" pin group |
| "Italian pizza places" | `search_places_by_text` query="italian pizza" | Add "Pizza" pin group |
| "Museums near the old bazaar" | `find_known_area` "old bazaar" → `search_places_nearby` | Add "Museums" pin group |
| "Is this place open now?" | `check_opening_status` | Text response in chat |
| "Does it accept cards?" | `get_place_details` | Text response in chat |
| "Wheelchair accessible cafés" | `search_places_nearby` types=["cafe"] → filter accessibilityOptions | Add "Cafés" pin group |
| "Vegan restaurants" | `search_places_by_text` query="vegan restaurant skopje" | Add "Vegan" pin group |
| "ATMs near me" | `search_places_nearby` types=["atm"] rank=DISTANCE | Add "ATMs" pin group |
| "Plan my morning" | `search_places_nearby` + `check_opening_status` × N + `build_route` + `estimate_tour_duration` | Route + numbered pins |
| "Rooftop bars" | `search_places_by_text` query="rooftop bar skopje" | Add "Bars" pin group |
| "Shopping in Aerodrom" | `find_known_area` "aerodrom" → `search_places_nearby` types=["shopping_mall", "market"] | Add "Shopping" pin group |

---

## What Google Places does NOT offer (and alternatives)

| Need | Google can't do it | Alternative |
|---|---|---|
| Current wait time / busyness | ❌ (removed from API) | No good free alternative |
| Menu / prices | ❌ | Yelp Fusion API (paid) |
| Reservation booking | ❌ | OpenTable API |
| Real-time weather | ❌ | OpenWeatherMap (free tier) |
| Route travel time | ❌ | Mapbox Directions (already used) |
| Public transit routes | ❌ | Google Directions API (separate, paid) |
| Elevation / terrain | ❌ | Mapbox Terrain API |

---

## Billing notes

Google Places API (New) bills per field group, not per call:
- **Basic fields** (id, displayName, location, types, businessStatus): ~$0.017 / 1000 requests
- **Advanced fields** (hours, phone, website, photos count): ~$0.035 / 1000 requests
- **Preferred fields** (reviews, editorialSummary, full photos with URLs): ~$0.10 / 1000 requests
- **Photo media resolution** (the `/media` endpoint): ~$0.007 / 1000 requests

The field masks defined above use "Advanced" + "Preferred" fields.
With Google's free tier ($200/month credit), you get roughly 2000 full-detail searches/month free.
For a university project with low traffic, the free tier is more than sufficient.
