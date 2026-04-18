import { useEffect, useRef, useState, type RefObject } from "react";
import {
  findNodeHandle,
  ScrollView,
  Text,
  View,
  type View as RNView,
} from "react-native";
import { usePalette } from "@/hooks/usePalette";
import { Card, Hairline, Segmented, ToggleRow } from "./_shared";
import { useSettingsForm } from "./SettingsFormContext";

export function BehaviourTab({
  scrollParentRef,
  scrollToY,
  pendingScrollTarget,
  onScrolledToTarget,
}: {
  scrollParentRef?: RefObject<ScrollView | null>;
  scrollToY?: (y: number) => void;
  pendingScrollTarget?: "telemetry" | null;
  onScrolledToTarget?: () => void;
} = {}) {
  const palette = usePalette();
  const {
    autoCompact,
    setAutoCompact,
    autoCompactThreshold,
    setAutoCompactThreshold,
    streamingEnabled,
    setStreamingEnabled,
    autoContinueEnabled,
    setAutoContinueEnabled,
    telemetryEnabled,
    setTelemetryEnabled,
    zenMode,
    setZenMode,
  } = useSettingsForm();

  const telemetryRowRef = useRef<RNView>(null);
  const [highlightTelemetry, setHighlightTelemetry] = useState(false);

  useEffect(() => {
    if (pendingScrollTarget !== "telemetry") return;
    const parentNode = scrollParentRef?.current
      ? findNodeHandle(scrollParentRef.current)
      : null;
    if (parentNode == null) return;

    // Give the tab content a frame to lay out before measuring.
    const timer = setTimeout(() => {
      telemetryRowRef.current?.measureLayout(
        parentNode,
        (_x, y) => {
          scrollToY?.(Math.max(0, y - 80));
          setHighlightTelemetry(true);
          setTimeout(() => setHighlightTelemetry(false), 1600);
          onScrolledToTarget?.();
        },
        () => {}
      );
    }, 60);

    return () => clearTimeout(timer);
  }, [pendingScrollTarget, scrollParentRef, scrollToY, onScrolledToTarget]);

  return (
    <Card>
      <ToggleRow
        title="Auto-compact"
        description="Summarise the conversation when the context window fills up and retry automatically."
        value={autoCompact}
        onValueChange={setAutoCompact}
      />
      {autoCompact && (
        <>
          <Hairline inset={20} />
          <View style={{ padding: 18, gap: 12 }}>
            <View style={{ gap: 4 }}>
              <Text
                style={{
                  color: palette.text,
                  fontSize: 15,
                  fontWeight: "600",
                  letterSpacing: 0.1,
                }}
              >
                Compact threshold
              </Text>
              <Text
                style={{
                  color: palette.textMuted,
                  fontSize: 13,
                  lineHeight: 18,
                }}
              >
                Compact the conversation when the last turn used at least this
                much of the model's context window.
              </Text>
            </View>
            <Segmented
              options={[
                { key: "50", label: "50%" },
                { key: "60", label: "60%" },
                { key: "70", label: "70%" },
                { key: "80", label: "80%" },
                { key: "90", label: "90%" },
              ]}
              value={String(autoCompactThreshold)}
              onChange={(k) => setAutoCompactThreshold(parseInt(k, 10))}
            />
          </View>
        </>
      )}
      <Hairline inset={20} />
      <ToggleRow
        title="Stream responses"
        description="Show words as they arrive. Turn off to display the full reply at once."
        value={streamingEnabled}
        onValueChange={setStreamingEnabled}
      />
      <Hairline inset={20} />
      <ToggleRow
        title="Auto-continue truncated replies"
        description="When a turn ends mid-sentence (ends with “:” or “,” etc.), automatically fire one “continue” so the model can finish. Helps with GLM and other models that give up early after tool-heavy turns."
        value={autoContinueEnabled}
        onValueChange={setAutoContinueEnabled}
      />
      <Hairline inset={20} />
      <ToggleRow
        title="Zen mode"
        description="Swap the thinking indicator's playful phrases for a guided breath cycle — inhale, reflect, exhale."
        value={zenMode}
        onValueChange={setZenMode}
      />
      <Hairline inset={20} />
      <View
        ref={telemetryRowRef}
        style={{
          backgroundColor: highlightTelemetry ? palette.surfaceAlt : "transparent",
          borderRadius: 12,
        }}
      >
        <ToggleRow
          title="Diagnostic telemetry"
          description="Mirror every SSE event the client receives to the backend events table. Used to diff what the server sent against what the client rendered."
          value={telemetryEnabled}
          onValueChange={setTelemetryEnabled}
        />
      </View>
    </Card>
  );
}
