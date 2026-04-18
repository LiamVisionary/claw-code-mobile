import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import Svg, { G, Path, Circle } from "react-native-svg";
import { GlassButton } from "@/components/ui/GlassButton";
import { usePalette } from "@/hooks/usePalette";
import { useGatewayStore } from "@/store/gatewayStore";
import { type Palette } from "@/constants/palette";
import { Card, Caption, Segmented, ToggleRow } from "./_shared";
import { useSettingsForm } from "./SettingsFormContext";

type Range = "24h" | "7d" | "30d" | "all";

type ModelRow = {
  model: string;
  messageCount: number;
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  avgTurnDurationMs: number | null;
};

type StatsResponse = {
  range: Range;
  since: string | null;
  totals: {
    messageCount: number;
    totalCostUsd: number;
    totalTokensIn: number;
    totalTokensOut: number;
  };
  models: ModelRow[];
};

const RANGE_OPTIONS: { key: Range; label: string }[] = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "all", label: "All" },
];

const formatUsd = (n: number): string => {
  if (!Number.isFinite(n) || n === 0) return "$0.00";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
};

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
};

const formatCount = (n: number): string => n.toLocaleString();

/**
 * Warm, desaturated slice palette. Kept short; cycled if there are more
 * models than colours. The ordering is intentional — the first (accent)
 * is used for the largest slice per DESIGN_GUIDELINES ("one accent per
 * screen"); subsequent slices use muted tones so the chart reads calm.
 */
const sliceColours = (palette: Palette): string[] => [
  palette.accent,
  palette.success,
  palette.textMuted,
  palette.danger,
  palette.textSoft,
];

const polarToCartesian = (
  cx: number,
  cy: number,
  r: number,
  angleRad: number
): { x: number; y: number } => ({
  x: cx + r * Math.cos(angleRad),
  y: cy + r * Math.sin(angleRad),
});

const arcPath = (
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): string => {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
};

function PieChart({
  slices,
  size,
}: {
  slices: { value: number; colour: string }[];
  size: number;
}) {
  const palette = usePalette();
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  if (total <= 0) {
    return (
      <Svg width={size} height={size}>
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          fill={palette.surfaceAlt}
        />
      </Svg>
    );
  }

  // Single-slice case — draw a full circle so we avoid a degenerate arc.
  if (slices.length === 1) {
    return (
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} fill={slices[0].colour} />
      </Svg>
    );
  }

  let angle = -Math.PI / 2; // start at 12 o'clock
  return (
    <Svg width={size} height={size}>
      <G>
        {slices.map((s, i) => {
          const sweep = (s.value / total) * Math.PI * 2;
          const d = arcPath(cx, cy, r, angle, angle + sweep);
          angle += sweep;
          return (
            <Path
              key={i}
              d={d}
              fill={s.colour}
              stroke={palette.bg}
              strokeWidth={1.5}
            />
          );
        })}
      </G>
    </Svg>
  );
}

function Legend({
  rows,
  total,
}: {
  rows: { model: string; cost: number; colour: string }[];
  total: number;
}) {
  const palette = usePalette();
  return (
    <View style={{ gap: 10, marginTop: 20 }}>
      {rows.map((row) => {
        const pct = total > 0 ? (row.cost / total) * 100 : 0;
        return (
          <View
            key={row.model}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                backgroundColor: row.colour,
              }}
            />
            <Text
              style={{
                flex: 1,
                color: palette.text,
                fontSize: 13,
                fontWeight: "500",
              }}
              numberOfLines={1}
            >
              {row.model}
            </Text>
            <Text
              style={{
                color: palette.textMuted,
                fontSize: 12,
                fontVariant: ["tabular-nums"],
              }}
            >
              {pct.toFixed(0)}%
            </Text>
            <Text
              style={{
                color: palette.text,
                fontSize: 13,
                fontWeight: "600",
                fontVariant: ["tabular-nums"],
                minWidth: 56,
                textAlign: "right",
              }}
            >
              {formatUsd(row.cost)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function StatsTable({ models }: { models: ModelRow[] }) {
  const palette = usePalette();
  return (
    <Card>
      <View
        style={{
          flexDirection: "row",
          paddingHorizontal: 18,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: palette.divider,
        }}
      >
        <Text
          style={{
            flex: 2,
            color: palette.textMuted,
            fontSize: 11,
            fontWeight: "600",
            letterSpacing: 0.6,
            textTransform: "uppercase",
          }}
        >
          Model
        </Text>
        <Text
          style={{
            flex: 1,
            color: palette.textMuted,
            fontSize: 11,
            fontWeight: "600",
            letterSpacing: 0.6,
            textTransform: "uppercase",
            textAlign: "right",
          }}
        >
          Cost
        </Text>
        <Text
          style={{
            flex: 1,
            color: palette.textMuted,
            fontSize: 11,
            fontWeight: "600",
            letterSpacing: 0.6,
            textTransform: "uppercase",
            textAlign: "right",
          }}
        >
          Msgs
        </Text>
        <Text
          style={{
            flex: 1,
            color: palette.textMuted,
            fontSize: 11,
            fontWeight: "600",
            letterSpacing: 0.6,
            textTransform: "uppercase",
            textAlign: "right",
          }}
        >
          Tokens
        </Text>
      </View>
      {models.map((row, i) => (
        <View
          key={row.model}
          style={{
            flexDirection: "row",
            paddingHorizontal: 18,
            paddingVertical: 14,
            ...(i > 0
              ? { borderTopWidth: 1, borderTopColor: palette.divider }
              : {}),
          }}
        >
          <Text
            style={{
              flex: 2,
              color: palette.text,
              fontSize: 13,
              fontWeight: "500",
              paddingRight: 8,
            }}
            numberOfLines={1}
          >
            {row.model}
          </Text>
          <Text
            style={{
              flex: 1,
              color: palette.text,
              fontSize: 13,
              fontWeight: "600",
              textAlign: "right",
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatUsd(row.totalCostUsd)}
          </Text>
          <Text
            style={{
              flex: 1,
              color: palette.textMuted,
              fontSize: 13,
              textAlign: "right",
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatCount(row.messageCount)}
          </Text>
          <Text
            style={{
              flex: 1,
              color: palette.textMuted,
              fontSize: 13,
              textAlign: "right",
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatTokens(row.totalTokensIn + row.totalTokensOut)}
          </Text>
        </View>
      ))}
    </Card>
  );
}

export function BudgetingTab({
  onGoToTelemetry,
}: {
  onGoToTelemetry?: () => void;
}) {
  const palette = usePalette();
  const serverUrl = useGatewayStore((s) => s.settings.serverUrl);
  const bearerToken = useGatewayStore((s) => s.settings.bearerToken);
  const telemetryEnabled = useGatewayStore(
    (s) => s.settings.telemetryEnabled ?? true
  );
  const { autoGenerateThreadTitles, setAutoGenerateThreadTitles } =
    useSettingsForm();

  const [range, setRange] = useState<Range>("30d");
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!serverUrl || !bearerToken) {
      setError("Configure server connection first.");
      setStats(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ range });
      const res = await fetch(
        `${serverUrl.replace(/\/+$/, "")}/analytics/stats?${params.toString()}`,
        { headers: { Authorization: `Bearer ${bearerToken}` } }
      );
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = (await res.json()) as StatsResponse;
      setStats(data);
    } catch (err: any) {
      setError(err.message ?? "Failed to load stats");
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [serverUrl, bearerToken, range]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const colours = useMemo(() => sliceColours(palette), [palette]);

  const chartSlices = useMemo(() => {
    if (!stats) return [];
    return stats.models
      .filter((m) => m.totalCostUsd > 0)
      .map((m, i) => ({
        value: m.totalCostUsd,
        colour: colours[i % colours.length],
      }));
  }, [stats, colours]);

  const legendRows = useMemo(() => {
    if (!stats) return [];
    return stats.models
      .filter((m) => m.totalCostUsd > 0)
      .map((m, i) => ({
        model: m.model,
        cost: m.totalCostUsd,
        colour: colours[i % colours.length],
      }));
  }, [stats, colours]);

  const autoTitleCard = (
    <Card>
      <ToggleRow
        title="Auto-generate thread titles"
        description="After your first exchange in a new thread, use the active model to pick a short title based on the opening messages. Costs one extra short API call per new thread."
        value={autoGenerateThreadTitles}
        onValueChange={setAutoGenerateThreadTitles}
      />
    </Card>
  );

  if (!telemetryEnabled) {
    return (
      <View style={{ gap: 14 }}>
        {autoTitleCard}
        <Card>
          <View style={{ paddingVertical: 32, paddingHorizontal: 24, gap: 16 }}>
            <Text
              style={{
                color: palette.text,
                fontSize: 16,
                fontWeight: "600",
                letterSpacing: 0.1,
              }}
            >
              Cost tracking is off
            </Text>
            <Text
              style={{
                color: palette.textMuted,
                fontSize: 14,
                lineHeight: 20,
              }}
            >
              Per-model spend and token counts are rolled up from diagnostic
              telemetry. Enable telemetry in Behaviour to start recording
              usage.
            </Text>
            <GlassButton
              onPress={onGoToTelemetry}
              style={{
                borderRadius: 12,
                paddingVertical: 13,
                width: "100%",
                marginTop: 4,
              }}
            >
              <Text
                style={{
                  color: palette.text,
                  fontWeight: "600",
                  fontSize: 14,
                  letterSpacing: 0.2,
                }}
              >
                Enable telemetry
              </Text>
            </GlassButton>
          </View>
        </Card>
      </View>
    );
  }

  return (
    <ScrollView
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={fetchStats}
          tintColor={palette.textMuted}
        />
      }
      contentContainerStyle={{ gap: 14 }}
    >
      {autoTitleCard}
      <Segmented options={RANGE_OPTIONS} value={range} onChange={setRange} />

      {error && (
        <Card>
          <View style={{ paddingVertical: 20, paddingHorizontal: 18 }}>
            <Text style={{ color: palette.danger, fontSize: 13 }}>{error}</Text>
          </View>
        </Card>
      )}

      {!error && stats === null && loading && (
        <View style={{ paddingVertical: 40, alignItems: "center" }}>
          <ActivityIndicator color={palette.textMuted} />
        </View>
      )}

      {!error && stats && stats.models.length === 0 && (
        <Card>
          <View style={{ paddingVertical: 32, alignItems: "center" }}>
            <Text
              style={{
                color: palette.textSoft,
                fontSize: 14,
                fontWeight: "500",
              }}
            >
              No usage recorded in this range
            </Text>
          </View>
        </Card>
      )}

      {!error && stats && stats.models.length > 0 && (
        <>
          <Card>
            <View
              style={{
                paddingVertical: 22,
                paddingHorizontal: 20,
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: palette.textMuted,
                  fontSize: 12,
                  fontWeight: "600",
                  letterSpacing: 1.2,
                  textTransform: "uppercase",
                }}
              >
                Total spend
              </Text>
              <Text
                style={{
                  color: palette.text,
                  fontSize: 32,
                  fontWeight: "600",
                  marginTop: 6,
                  marginBottom: 18,
                  fontVariant: ["tabular-nums"],
                  letterSpacing: -0.5,
                }}
              >
                {formatUsd(stats.totals.totalCostUsd)}
              </Text>
              {chartSlices.length > 0 ? (
                <PieChart slices={chartSlices} size={200} />
              ) : (
                <Text
                  style={{
                    color: palette.textSoft,
                    fontSize: 13,
                    marginTop: 12,
                  }}
                >
                  No cost data yet
                </Text>
              )}
              {legendRows.length > 0 && (
                <View style={{ alignSelf: "stretch" }}>
                  <Legend
                    rows={legendRows}
                    total={stats.totals.totalCostUsd}
                  />
                </View>
              )}
            </View>
          </Card>

          <StatsTable models={stats.models} />
        </>
      )}

      <Caption>
        Costs and token counts are aggregated from finalized assistant turns.
        Messages without a recorded model are excluded.
      </Caption>
    </ScrollView>
  );
}
