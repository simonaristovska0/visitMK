import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Only create in browser — Supabase Realtime needs WebSocket which Node 20 lacks.
// All auth/db calls in this app live inside useEffect, so SSR never touches this.
export const supabase = typeof window !== "undefined"
  ? createClient(url, key)
  : (null as unknown as ReturnType<typeof createClient>);

export type SavedLandmarkRow = {
  id: string;
  user_id: string;
  landmark_id: string;
  landmark_data: import("./types").Landmark;
  saved_at: string;
};
