export type Category = "outdoors" | "food" | "cafe" | "shopping" | "culture" | "landmark";
export type TravelMode = "walking" | "driving";

export interface Coordinates { lat: number; lng: number }

export interface PlaceReview {
  author: string;
  rating: number;
  text: string;
  relativeTime: string;
}

export interface Landmark {
  id: string;
  name: string;
  nameCyrillic?: string;
  category: Category;
  coordinates: Coordinates;
  rating: number;
  reviewCount: number;
  priceMKD: number;  // 0 = free
  priceLabel?: string; // "€" | "€€" | "€€€" | "€€€€"
  openingHours: { open: string; close: string; openNow: boolean };
  weeklyHours?: string[]; // e.g. ["Monday: 9:00 AM – 10:00 PM", ...]
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
