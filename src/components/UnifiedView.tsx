import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Map, PenLine, X } from "lucide-react";
import type { Itinerary, Landmark, TravelMode } from "@/lib/types";
import { useMapState } from "@/hooks/useMapState";
import { useChat } from "@/hooks/useChat";
import { useAuth } from "@/lib/auth";
import { MapView } from "@/components/MapView";
import { ChatPanel } from "@/components/ChatPanel";
import { LandmarkDetail } from "@/components/LandmarkDetail";
import { RouteBuilder } from "@/components/RouteBuilder";
import { ActiveTourWidget } from "@/components/ActiveTourWidget";
import { AuthModal } from "@/components/AuthModal";
import { buildItinerary } from "@/lib/api/itinerary.functions";
import { saveTour } from "@/lib/api/savedTour";
import { cn } from "@/lib/utils";

// ── Category chips ────────────────────────────────────────────────────────────

function CategoryChips({
  groups,
  onToggle,
  onRemove,
}: {
  groups: ReturnType<typeof useMapState>["groups"];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (groups.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide px-4 pb-1">
      {groups.map((g) => (
        <div
          key={g.id}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium shadow-sm backdrop-blur transition-opacity",
            g.visible
              ? "border-transparent text-white"
              : "border-border bg-card/90 text-muted-foreground opacity-60",
          )}
          style={g.visible ? { background: g.color } : {}}
        >
          <button type="button" onClick={() => onToggle(g.id)} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-white/80" />
            {g.label}
          </button>
          <button
            type="button"
            onClick={() => onRemove(g.id)}
            className="ml-0.5 rounded-full p-0.5 hover:bg-black/20 transition-colors"
            aria-label={`Remove ${g.label}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function UnifiedView() {
  // Map state
  const mapState = useMapState();
  const { visiblePins, groups, route, routeLandmarks, userLocation, addGroup, removeGroup, toggleGroup, setRoute, setUserLocation, findLandmark } = mapState;

  // Auth state
  const { user } = useAuth();

  // Chat state
  const { messages, isLoading, sendMessage, clearMessages } = useChat({
    onGroupAdded: addGroup,
    onRouteCreated: setRoute,
  });

  // UI state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRouteBuilder, setShowRouteBuilder] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);   // mobile: drawer open/closed

  // Save tour state
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const pendingSave = useRef(false);

  // When user logs in while a save is pending, fire the save automatically
  useEffect(() => {
    if (user && pendingSave.current && route && routeLandmarks.length > 0) {
      pendingSave.current = false;
      void doSaveTour(user.id, route, routeLandmarks);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Reset saved state whenever the active route changes
  useEffect(() => {
    setIsSaved(false);
  }, [route?.id]);

  const doSaveTour = useCallback(async (userId: string, itinerary: Itinerary, landmarks: Landmark[]) => {
    setIsSaving(true);
    const { error } = await saveTour(userId, itinerary, landmarks);
    setIsSaving(false);
    if (!error) setIsSaved(true);
  }, []);

  const handleSaveTour = useCallback(() => {
    if (!route || routeLandmarks.length === 0) return;
    if (!user) {
      pendingSave.current = true;
      setShowAuthModal(true);
    } else {
      void doSaveTour(user.id, route, routeLandmarks);
    }
  }, [user, route, routeLandmarks, doSaveTour]);

  // If the user clicked "Load on map" from the saved tours page, restore it now
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("vmk_load_tour");
      if (raw) {
        sessionStorage.removeItem("vmk_load_tour");
        const { itinerary, landmarks } = JSON.parse(raw) as {
          itinerary: Itinerary;
          landmarks: Landmark[];
        };
        setRoute(itinerary, landmarks);
      }
    } catch {}
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Request GPS on mount
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setUserLocation({ lat: 41.9973, lng: 21.428 }),  // Skopje center fallback
      { timeout: 8000 },
    );
  }, [setUserLocation]);

  // Colour map for chat cards (groupId → color)
  const groupColors = useMemo(
    () => Object.fromEntries(groups.map((g) => [g.id, g.color])),
    [groups],
  );

  // Pins to show on the map (visible group pins + route pins)
  const allPins = useMemo(() => {
    // Numbered route pins — these take priority over any group pin for the same landmark
    const routePins = route
      ? routeLandmarks.map((lm, i) => ({
          landmark: lm,
          order: i + 1,
        }))
      : [];
    const routeIds = new Set(routePins.map((p) => p.landmark.id));
    // Group pins, excluding any landmark already shown as a numbered route stop
    const groupPins = visiblePins
      .filter(({ landmark }) => !routeIds.has(landmark.id))
      .map(({ landmark, groupColor }) => ({ landmark, color: groupColor }));
    return [...groupPins, ...routePins];
  }, [visiblePins, route, routeLandmarks]);

  // Route line IDs
  const routeIds = useMemo(
    () => (route ? route.stops.map((s) => s.landmarkId) : undefined),
    [route],
  );

  // Build a manual route from the RouteBuilder panel
  const handleBuildManualRoute = useCallback(
    async (landmarks: Landmark[], mode: TravelMode) => {
      setIsBuilding(true);
      try {
        const waypoints = landmarks.map((lm) => ({
          id: lm.id,
          coordinates: lm.coordinates,
          category: lm.category,
        }));
        const result = await buildItinerary({ data: { waypoints, travelMode: mode, wish: "Custom route" } });
        const itinerary = result.itinerary;
        setRoute(itinerary, landmarks);
      } finally {
        setIsBuilding(false);
      }
    },
    [setRoute],
  );

  // Recalculate route with a new stop order (from ActiveTourWidget drag-and-drop)
  const handleRecalculateRoute = useCallback(
    async (orderedLandmarks: Landmark[], mode: TravelMode) => {
      setIsRecalculating(true);
      try {
        const waypoints = orderedLandmarks.map((lm) => ({
          id: lm.id,
          coordinates: lm.coordinates,
          category: lm.category,
        }));
        const result = await buildItinerary({
          data: { waypoints, travelMode: mode, wish: route?.wish ?? "Custom tour" },
        });
        setRoute(result.itinerary, orderedLandmarks);
      } finally {
        setIsRecalculating(false);
      }
    },
    [route, setRoute],
  );

  const handleSend = useCallback(
    (text: string) => sendMessage(text, userLocation),
    [sendMessage, userLocation],
  );

  const handleLandmarkClick = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const selectedLandmark = selectedId ? findLandmark(selectedId) : null;

  // All visible landmark data (for RouteBuilder available list)
  const allVisibleLandmarks = useMemo(
    () => visiblePins.map(({ landmark }) => landmark),
    [visiblePins],
  );

  return (
    <>
      {/*
        Desktop layout: map left (flex-1), chat/builder right (420px fixed)
        Mobile layout: map top (55%), chat drawer bottom (45%)
      */}
      <div className="flex h-[calc(100vh-5rem)] md:h-screen">

        {/* ── LEFT: Map ── */}
        <div className="relative flex-1">
          <MapView
            pins={allPins}
            routeIds={routeIds}
            travelMode={route?.travelMode ?? "walking"}
            userLocation={userLocation ?? undefined}
            selectedId={selectedId ?? undefined}
            onPinClick={handleLandmarkClick}
            className="h-full w-full"
          />

          {/* Active tour widget — visible whenever a route is active */}
          {route && routeLandmarks.length > 0 && (
            <div className="absolute inset-x-4 bottom-16 z-25 md:max-w-sm md:right-auto">
              <ActiveTourWidget
                itinerary={route}
                landmarks={routeLandmarks}
                onRecalculate={handleRecalculateRoute}
                onClose={() => setRoute(null, [])}
                onStopClick={handleLandmarkClick}
                onQuickAdd={handleSend}
                onSave={handleSaveTour}
                isRecalculating={isRecalculating}
                isSaving={isSaving}
                isSaved={isSaved}
              />
            </div>
          )}

          {/* Category chips overlay (bottom of map) */}
          <div className="absolute inset-x-0 bottom-4 z-20 space-y-2">
            <CategoryChips groups={groups} onToggle={toggleGroup} onRemove={removeGroup} />
          </div>

          {/* "Create route" FAB — hidden when tour widget is visible */}
          {!route && (
            <button
              type="button"
              onClick={() => setShowRouteBuilder(true)}
              className={cn(
                "absolute bottom-16 right-4 z-20 flex items-center gap-2 rounded-full px-4 py-2.5",
                "bg-card/95 text-sm font-semibold shadow-lg backdrop-blur border border-border",
                "hover:border-primary/40 transition-colors md:bottom-20",
              )}
            >
              <PenLine className="h-4 w-4" />
              Create route
            </button>
          )}

          {/* Mobile chat toggle FAB */}
          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            className="absolute right-4 top-4 z-20 grid h-10 w-10 place-items-center rounded-full bg-card/95 shadow-lg backdrop-blur border border-border md:hidden"
            aria-label="Toggle chat"
          >
            <Map className="h-5 w-5" />
          </button>
        </div>

        {/* ── RIGHT: Chat panel (desktop) ── */}
        <div className="hidden w-[420px] shrink-0 border-l border-border md:flex md:flex-col">
          {showRouteBuilder ? (
            <RouteBuilder
              availableLandmarks={allVisibleLandmarks}
              onBuildRoute={handleBuildManualRoute}
              itinerary={route}
              isBuilding={isBuilding}
              onClose={() => setShowRouteBuilder(false)}
            />
          ) : (
            <ChatPanel
              messages={messages}
              isLoading={isLoading}
              groupColors={groupColors}
              onSend={handleSend}
              onLandmarkClick={handleLandmarkClick}
              onRestoreTour={setRoute}
              onNewChat={clearMessages}
            />
          )}
        </div>
      </div>

      {/* ── Mobile: chat drawer ── */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-[5rem] z-30 md:hidden transition-transform duration-300",
          chatOpen ? "translate-y-0" : "translate-y-full",
        )}
        style={{ height: "45vh" }}
      >
        <div className="h-full rounded-t-2xl border-t border-border bg-background shadow-2xl">
          {/* Drag handle */}
          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            className="flex w-full items-center justify-center py-2"
            aria-label="Toggle chat"
          >
            <span className="h-1 w-10 rounded-full bg-border" />
          </button>
          {showRouteBuilder ? (
            <RouteBuilder
              availableLandmarks={allVisibleLandmarks}
              onBuildRoute={handleBuildManualRoute}
              itinerary={route}
              isBuilding={isBuilding}
              onClose={() => setShowRouteBuilder(false)}
            />
          ) : (
            <ChatPanel
              messages={messages}
              isLoading={isLoading}
              groupColors={groupColors}
              onSend={handleSend}
              onLandmarkClick={handleLandmarkClick}
              onRestoreTour={setRoute}
              onNewChat={clearMessages}
              className="h-[calc(100%-2rem)]"
            />
          )}
        </div>
      </div>

      {/* ── Auth modal (shown when unauthenticated user tries to save) ── */}
      <AuthModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        prompt="Sign in to save this tour to your account."
      />

      {/* ── Landmark detail sheet ── */}
      <LandmarkDetail
        landmark={selectedLandmark}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}
