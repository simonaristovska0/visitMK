import type { Landmark, Itinerary } from "./types";
import matka from "@/assets/matka.jpg";
import bazaar from "@/assets/bazaar.jpg";
import restaurant from "@/assets/restaurant.jpg";
import stonebridge from "@/assets/stonebridge.jpg";
import mosque from "@/assets/mosque.jpg";
import vodno from "@/assets/vodno.jpg";

export const landmarks: Landmark[] = [
  {
    id: "matka",
    name: "Canyon Matka",
    nameCyrillic: "Кањон Матка",
    category: "outdoors",
    coordinates: { lat: 41.9536, lng: 21.3000 },
    rating: 4.8,
    reviewCount: 4231,
    priceMKD: 0,
    openingHours: { open: "06:00", close: "20:00", openNow: true },
    walkTimeMinutes: 6,
    heroImage: matka,
    eyebrow: "Natural Monument",
    history:
      "Carved by the Treska River over millennia, Canyon Matka is one of North Macedonia's most outstanding outdoor destinations. Its cliffs shelter medieval monasteries, ten caves, and rare endemic species — a quiet, vertical world fifteen kilometers from the capital.",
    practicalInfo:
      "Open daily 06:00–20:00. Free entry. Kayak rental from 400 MKD/hr. Boat tours into Vrelo Cave depart from the dam every 30 min.",
    wikipediaSummary: "A canyon located west of Skopje on the Treska River.",
  },
  {
    id: "trattoria",
    name: "Trattoria Vino",
    category: "food",
    coordinates: { lat: 41.9981, lng: 21.4254 },
    rating: 4.6,
    reviewCount: 812,
    priceMKD: 950,
    openingHours: { open: "12:00", close: "23:30", openNow: true },
    walkTimeMinutes: 3,
    heroImage: restaurant,
    eyebrow: "Italian · Wine bar",
    history:
      "A candlelit room in the Debar Maalo neighbourhood, Trattoria Vino has served handmade pasta and Balkan-Italian wines since 2009.",
    practicalInfo: "Daily 12:00–23:30. Reservations recommended on weekends. Mains 600–1,400 MKD.",
  },
  {
    id: "bazaar",
    name: "Old Bazaar",
    nameCyrillic: "Стара Чаршија",
    category: "shopping",
    coordinates: { lat: 42.0006, lng: 21.4385 },
    rating: 4.7,
    reviewCount: 6120,
    priceMKD: 0,
    openingHours: { open: "09:00", close: "21:00", openNow: true },
    walkTimeMinutes: 4,
    heroImage: bazaar,
    eyebrow: "Cultural Heritage",
    history:
      "The largest preserved Ottoman bazaar in the Balkans outside Istanbul. Since the 12th century its cobbled lanes have housed coppersmiths, jewellers, tailors and tea houses — and still do.",
    practicalInfo: "Shops generally 09:00–21:00. Closed Sunday afternoons. Cash and card accepted.",
  },
  {
    id: "stonebridge",
    name: "Stone Bridge",
    nameCyrillic: "Камен Мост",
    category: "landmark",
    coordinates: { lat: 41.9968, lng: 21.4318 },
    rating: 4.5,
    reviewCount: 3450,
    priceMKD: 0,
    openingHours: { open: "00:00", close: "23:59", openNow: true },
    walkTimeMinutes: 2,
    heroImage: stonebridge,
    eyebrow: "City Icon · 15th c.",
    history:
      "Spanning the Vardar between Macedonia Square and the Old Bazaar, the Stone Bridge was built under Sultan Mehmed II in the 1450s on Roman foundations. It is the city's enduring symbol.",
    practicalInfo: "Open 24h, pedestrians only. Best photographed at golden hour from the east bank.",
  },
  {
    id: "mosque",
    name: "Mustafa Pasha Mosque",
    nameCyrillic: "Мустафа-пашина џамија",
    category: "culture",
    coordinates: { lat: 42.0027, lng: 21.4365 },
    rating: 4.7,
    reviewCount: 1820,
    priceMKD: 120,
    openingHours: { open: "10:00", close: "18:00", openNow: true },
    walkTimeMinutes: 5,
    heroImage: mosque,
    eyebrow: "UNESCO Tentative List",
    history:
      "Commissioned in 1492 by the vizier Mustafa Pasha, the mosque survived earthquakes that flattened most of the surrounding quarter. Its single dome and slender minaret remain a textbook example of classical Ottoman religious architecture.",
    practicalInfo: "Daily 10:00–18:00, closed during prayer. Entry 120 MKD. Modest dress required; scarves provided.",
  },
  {
    id: "vodno",
    name: "Millennium Cross, Vodno",
    nameCyrillic: "Милениумски Крст",
    category: "landmark",
    coordinates: { lat: 41.9619, lng: 21.4006 },
    rating: 4.6,
    reviewCount: 2934,
    priceMKD: 200,
    openingHours: { open: "09:00", close: "19:00", openNow: false },
    walkTimeMinutes: 25,
    heroImage: vodno,
    eyebrow: "Panoramic Viewpoint",
    history:
      "Erected in 2002 atop Mount Vodno at 1,066 m to mark two millennia of Christianity, the 66-metre cross is visible from across the Skopje basin. The cable car climbs the final stretch.",
    practicalInfo: "Cable car 09:00–19:00 (weather permitting). Return ticket 200 MKD. Bring a layer — it's cool at the top.",
  },
];

export const landmarkById = Object.fromEntries(landmarks.map((l) => [l.id, l])) as Record<string, Landmark>;

export const mockItinerary: Itinerary = {
  id: "today",
  wish: "Canyon Matka, Italian food, then shopping in the old town",
  travelMode: "driving",
  totalDurationMinutes: 4 * 60 + 15,
  totalDistanceKm: 38,
  stops: [
    { landmarkId: "matka", order: 1, durationMinutes: 120 },
    {
      landmarkId: "trattoria",
      order: 2,
      durationMinutes: 75,
      travelFromPrevious: { distanceKm: 18, durationMinutes: 28, mode: "driving" },
    },
    {
      landmarkId: "bazaar",
      order: 3,
      durationMinutes: 60,
      travelFromPrevious: { distanceKm: 2, durationMinutes: 8, mode: "driving" },
    },
  ],
};
