import { supabase } from "@/lib/supabase";
import type { Itinerary, Landmark } from "@/lib/types";

export async function saveTour(
  userId: string,
  itinerary: Itinerary,
  landmarks: Landmark[],
): Promise<{ error: string | null }> {
  if (!supabase) return { error: "Supabase not available" };

  const name = itinerary.wish || `Tour (${itinerary.stops.length} stops)`;

  const { error } = await supabase.from("saved_tours").insert({
    user_id: userId,
    name,
    itinerary,
    landmarks,
  });

  return { error: error?.message ?? null };
}
