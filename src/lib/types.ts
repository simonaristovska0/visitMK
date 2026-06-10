export type Category = "outdoors" | "food" | "cafe" | "shopping" | "culture" | "landmark";
export type TravelMode = "walking" | "driving";

export interface Coordinates { lat: number; lng: number }

export interface PlaceReview {
  author: string;
  rating: number;
  text: string;
  relativeTime: string;
}

// Extra attributes returned by the richer MCP field mask (Tools 1 & 2)
export interface PlaceAttributes {
  googleMapsUri?: string;
  dineIn?: boolean;
  takeout?: boolean;
  delivery?: boolean;
  reservable?: boolean;
  outdoorSeating?: boolean;
  liveMusic?: boolean;
  goodForChildren?: boolean;
  allowsDogs?: boolean;
  goodForGroups?: boolean;
  servesVegetarianFood?: boolean;
  servesBeer?: boolean;
  servesWine?: boolean;
  servesCoffee?: boolean;
  paymentOptions?: {
    acceptsCreditCards?: boolean;
    acceptsDebitCards?: boolean;
    acceptsCashOnly?: boolean;
    acceptsNfc?: boolean;
  };
  accessibilityOptions?: {
    wheelchairAccessibleEntrance?: boolean;
    wheelchairAccessibleParking?: boolean;
    wheelchairAccessibleRestroom?: boolean;
    wheelchairAccessibleSeating?: boolean;
  };
}

export interface Landmark {
  id: string;
  name: string;
  nameCyrillic?: string;
  category: Category;
  coordinates: Coordinates;
  rating: number;
  reviewCount: number;
  priceMKD: number;
  priceLabel?: string;
  openingHours: { open: string; close: string; openNow: boolean };
  weeklyHours?: string[];
  walkTimeMinutes: number;
  heroImage: string;
  eyebrow?: string;
  history: string;
  practicalInfo: string;
  phone?: string;
  website?: string;
  reviews?: PlaceReview[];
  wikipediaSummary?: string;
  wikidataId?: string;
  wikipediaArticle?: string;
  // Extended attributes from MCP tools
  attributes?: PlaceAttributes;
}

export interface TravelLeg {
  distanceKm: number;
  durationMinutes: number;
  mode: TravelMode;
}

export interface RouteStop {
  landmarkId: string;
  order: number;
  durationMinutes: number;
  travelFromPrevious?: TravelLeg;
}

export interface Itinerary {
  id: string;
  wish: string;
  stops: RouteStop[];
  totalDurationMinutes: number;
  totalDistanceKm: number;
  travelMode: TravelMode;
}

// ── Chat types ────────────────────────────────────────────────────────────────

export type ChatMessageRole = "user" | "assistant";

export interface ChatMessageBase {
  id: string;
  role: ChatMessageRole;
  createdAt: number;
}

export interface TextChatMessage extends ChatMessageBase {
  type: "text";
  content: string;
}

export interface PlacesAddedChatMessage extends ChatMessageBase {
  type: "places_added";
  content: string;         // summary text, e.g. "Found 8 restaurants near the Old Bazaar"
  groupId: string;         // references the PinGroup that was created
  landmarks: Landmark[];
}

export interface RouteCreatedChatMessage extends ChatMessageBase {
  type: "route_created";
  content: string;         // summary text
  itinerary: Itinerary;
  landmarks: Landmark[];   // full landmark data for each stop
}

export interface ErrorChatMessage extends ChatMessageBase {
  type: "error";
  content: string;
}

export type ChatMessage =
  | TextChatMessage
  | PlacesAddedChatMessage
  | RouteCreatedChatMessage
  | ErrorChatMessage;

// ── Map state types ───────────────────────────────────────────────────────────

// Pin colours — one per group, cycling through this palette
export const PIN_GROUP_COLORS = [
  "#E85D04", // orange   (primary)
  "#0077B6", // blue
  "#2D6A4F", // green
  "#9B2226", // red
  "#7B2D8B", // purple
  "#B5838D", // rose
  "#606C38", // olive
] as const;

export interface PinGroup {
  id: string;
  label: string;
  color: string;
  landmarks: Landmark[];
  visible: boolean;
}

export interface MapState {
  groups: PinGroup[];
  route: Itinerary | null;
  routeLandmarks: Landmark[];   // full data for route stops (needed by TourSummaryCard)
  userLocation: Coordinates | null;
}
