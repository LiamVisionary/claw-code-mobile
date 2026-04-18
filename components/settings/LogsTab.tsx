import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { usePalette } from "@/hooks/usePalette";
import { useGatewayStore } from "@/store/gatewayStore";
import { Card, Caption, Segmented } from "./_shared";

type EventSource = "runtime" | "stream" | "route" | "client";

type EventRow = {
  id: number;
  ts: number;
  source: EventSource;
  type: string;
  threadId: string | null;
  runId: string | null;
  payload: Record<string, unknown>;
};

const SOURCE_OPTIONS: { key: EventSource | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "runtime", label: "Runtime" },
  { key: "stream", label: "Stream" },
  { key: "route", label: "Route" },
  { key: "client", label: "Client" },
];

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 1_000) return "now";
  if (diff < 60_000) return `${Math.floor(diff / 1_000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function EventRowView({ event }: { event: EventRow }) {
  const palette = usePalette();
  const [expanded, setExpanded] = useState(false);
  const payloadStr = JSON.stringify(event.payload, null, 2);
  const hasPayload = payloadStr && payloadStr !== "{}";

  return (
    <TouchableBounce
      sensory
      onPress={() => hasPayload && setExpanded((v) => !v)}
      disabled={!hasPayload}
    >
      <View style={{ paddingVertical: 12, paddingHorizontal: 18, gap: 6 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <View
            style={{
              paddingHorizontal: 7,
              paddingVertical: 2,
              borderRadius: 999,
              backgroundColor: palette.surfaceAlt,
            }}
          >
            <Text
              style={{
                color: palette.textMuted,
                fontSize: 10,
                fontWeight: "600",
                letterSpacing: 0.5,
                textTransform: "uppercase",
              }}
            >
              {event.source}
            </Text>
          </View>
          <Text
            style={{
              color: palette.text,
              fontSize: 14,
              fontWeight: "600",
              flex: 1,
            }}
            numberOfLines={1}
          >
            {event.type}
          </Text>
          <Text
            style={{
              color: palette.textSoft,
              fontSize: 11,
              fontWeight: "500",
            }}
          >
            {relativeTime(event.ts)}
          </Text>
        </View>
        {(event.threadId || event.runId) && (
          <Text
            style={{
              color: palette.textSoft,
              fontSize: 11,
              fontFamily: "Menlo",
            }}
            numberOfLines={1}
          >
            {event.threadId ? `thread ${event.threadId.slice(0, 8)}` : ""}
            {event.threadId && event.runId ? "  ·  " : ""}
            {event.runId ? `run ${event.runId.slice(0, 8)}` : ""}
          </Text>
        )}
        {expanded && hasPayload && (
          <View
            style={{
              backgroundColor: palette.surfaceAlt,
              borderRadius: 8,
              padding: 10,
              marginTop: 4,
            }}
          >
            <Text
              style={{
                color: palette.textMuted,
                fontSize: 11,
                fontFamily: "Menlo",
                lineHeight: 15,
              }}
            >
              {payloadStr}
            </Text>
          </View>
        )}
      </View>
    </TouchableBounce>
  );
}

export function LogsTab() {
  const palette = usePalette();
  const serverUrl = useGatewayStore((s) => s.settings.serverUrl);
  const bearerToken = useGatewayStore((s) => s.settings.bearerToken);

  const [source, setSource] = useState<EventSource | "all">("all");
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    if (!serverUrl || !bearerToken) {
      setError("Configure server connection first.");
      setEvents(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (source !== "all") params.set("source", source);
      const res = await fetch(
        `${serverUrl.replace(/\/+$/, "")}/events?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${bearerToken}` },
        }
      );
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = (await res.json()) as { events: EventRow[] };
      setEvents(data.events);
    } catch (err: any) {
      setError(err.message ?? "Failed to load events");
      setEvents(null);
    } finally {
      setLoading(false);
    }
  }, [serverUrl, bearerToken, source]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return (
    <ScrollView
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={fetchEvents}
          tintColor={palette.textMuted}
        />
      }
      contentContainerStyle={{ gap: 14 }}
    >
      <Segmented
        options={SOURCE_OPTIONS}
        value={source}
        onChange={setSource}
      />

      {error && (
        <Card>
          <View style={{ paddingVertical: 20, paddingHorizontal: 18 }}>
            <Text style={{ color: palette.danger, fontSize: 13 }}>
              {error}
            </Text>
          </View>
        </Card>
      )}

      {!error && events === null && loading && (
        <View style={{ paddingVertical: 40, alignItems: "center" }}>
          <ActivityIndicator color={palette.textMuted} />
        </View>
      )}

      {!error && events && events.length === 0 && (
        <Card>
          <View style={{ paddingVertical: 32, alignItems: "center" }}>
            <Text
              style={{
                color: palette.textSoft,
                fontSize: 14,
                fontWeight: "500",
              }}
            >
              No events yet
            </Text>
          </View>
        </Card>
      )}

      {!error && events && events.length > 0 && (
        <Card>
          {events.map((e, i) => (
            <View key={e.id}>
              {i > 0 && (
                <View
                  style={{
                    height: 1,
                    backgroundColor: palette.divider,
                    marginLeft: 18,
                  }}
                />
              )}
              <EventRowView event={e} />
            </View>
          ))}
        </Card>
      )}

      <Caption>
        Newest first. Tap a row to expand its payload. Sources: runtime
        (claw-code harness), stream (SSE emitter), route (HTTP handlers),
        client (this app).
      </Caption>
    </ScrollView>
  );
}
