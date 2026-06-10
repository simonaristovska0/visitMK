import { useState, useCallback } from "react";
import type { Coordinates, Itinerary, Landmark, MapState, PinGroup } from "@/lib/types";
import { PIN_GROUP_COLORS } from "@/lib/types";

const INITIAL_STATE: MapState = {
  groups: [],
  route: null,
  routeLandmarks: [],
  userLocation: null,
};

export function useMapState() {
  const [state, setState] = useState<MapState>(INITIAL_STATE);

  // Pick the next colour from the palette, cycling if all are used
  const nextColor = useCallback((groups: PinGroup[]): string => {
    return PIN_GROUP_COLORS[groups.length % PIN_GROUP_COLORS.length];
  }, []);

  // Add a new group of landmarks to the map (from an LLM tool result)
  const addGroup = useCallback((id: string, label: string, landmarks: Landmark[]) => {
    setState((prev) => ({
      ...prev,
      groups: [
        ...prev.groups,
        {
          id,
          label,
          color: nextColor(prev.groups),
          landmarks,
          visible: true,
        },
      ],
    }));
  }, [nextColor]);

  // Remove a group entirely (user clicks × on a chip)
  const removeGroup = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      groups: prev.groups.filter((g) => g.id !== id),
    }));
  }, []);

  // Toggle a group's visibility (user clicks the chip label)
  const toggleGroup = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === id ? { ...g, visible: !g.visible } : g,
      ),
    }));
  }, []);

  // Set or clear the active route (from LLM tour planning or manual builder)
  const setRoute = useCallback((itinerary: Itinerary | null, landmarks: Landmark[] = []) => {
    setState((prev) => ({
      ...prev,
      route: itinerary,
      routeLandmarks: landmarks,
    }));
  }, []);

  // Update the user's GPS location
  const setUserLocation = useCallback((location: Coordinates | null) => {
    setState((prev) => ({ ...prev, userLocation: location }));
  }, []);

  // Clear all groups and the route (fresh start)
  const clearAll = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  // All visible pins flattened — passed to MapView
  const visiblePins = state.groups
    .filter((g) => g.visible)
    .flatMap((g) => g.landmarks.map((lm) => ({ landmark: lm, groupColor: g.color })));

  // Find a landmark by ID across all groups (needed when user taps a pin)
  const findLandmark = useCallback(
    (id: string): Landmark | null => {
      for (const g of state.groups) {
        const found = g.landmarks.find((l) => l.id === id);
        if (found) return found;
      }
      for (const lm of state.routeLandmarks) {
        if (lm.id === id) return lm;
      }
      return null;
    },
    [state.groups, state.routeLandmarks],
  );

  return {
    ...state,
    visiblePins,
    addGroup,
    removeGroup,
    toggleGroup,
    setRoute,
    setUserLocation,
    clearAll,
    findLandmark,
  };
}
