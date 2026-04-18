import { useCallback, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { GlassButton } from "@/components/ui/GlassButton";
import { usePalette } from "@/hooks/usePalette";
import { useGatewayStore } from "@/store/gatewayStore";
import {
  SettingsFormProvider,
  useSettingsForm,
} from "@/components/settings/SettingsFormContext";
import { ConnectionTab } from "@/components/settings/ConnectionTab";
import { AppearanceTab } from "@/components/settings/AppearanceTab";
import { ModelsTab } from "@/components/settings/ModelsTab";
import { BehaviourTab } from "@/components/settings/BehaviourTab";
import { VaultTab } from "@/components/settings/VaultTab";
import { LogsTab } from "@/components/settings/LogsTab";
import { BudgetingTab } from "@/components/settings/BudgetingTab";

type TabKey =
  | "connection"
  | "models"
  | "appearance"
  | "behaviour"
  | "vault"
  | "budgeting"
  | "logs";

const BASE_TABS: { key: TabKey; label: string }[] = [
  { key: "connection", label: "Connection" },
  { key: "models", label: "Models" },
  { key: "appearance", label: "Appearance" },
  { key: "behaviour", label: "Behaviour" },
  { key: "vault", label: "Notes" },
  { key: "budgeting", label: "Budgeting" },
];

export default function SettingsScreen() {
  return (
    <SettingsFormProvider>
      <SettingsContent />
    </SettingsFormProvider>
  );
}

function SettingsContent() {
  const palette = usePalette();
  const { hasChanges, revert } = useSettingsForm();
  const telemetryEnabled = useGatewayStore(
    (s) => s.settings.telemetryEnabled ?? true
  );
  const [activeTab, setActiveTab] = useState<TabKey>("connection");
  const scrollRef = useRef<ScrollView>(null);
  const [pendingScrollTarget, setPendingScrollTarget] = useState<
    "telemetry" | null
  >(null);

  const scrollToY = useCallback((y: number) => {
    scrollRef.current?.scrollTo({ y, animated: true });
  }, []);

  const handleGoToTelemetry = useCallback(() => {
    setActiveTab("behaviour");
    setPendingScrollTarget("telemetry");
  }, []);

  const handleScrolledToTarget = useCallback(() => {
    setPendingScrollTarget(null);
  }, []);

  const tabs = useMemo<{ key: TabKey; label: string }[]>(
    () =>
      telemetryEnabled
        ? [...BASE_TABS, { key: "logs", label: "Logs" }]
        : BASE_TABS,
    [telemetryEnabled]
  );

  // If telemetry is toggled off while viewing Logs, fall back to the first tab.
  if (activeTab === "logs" && !telemetryEnabled) {
    setActiveTab("connection");
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: palette.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
    >
      <ScrollView
        ref={scrollRef}
        style={{ backgroundColor: palette.bg }}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustsScrollIndicatorInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        stickyHeaderIndices={[0]}
      >
        {/* Sticky tab bar — pinned below the nav header while scrolling. */}
        <View style={{ backgroundColor: palette.bg }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: 22,
              paddingTop: 8,
              paddingBottom: 14,
              gap: 8,
            }}
          >
            {tabs.map((t) => {
              const selected = activeTab === t.key;
              return (
                <TouchableBounce
                  key={t.key}
                  sensory
                  onPress={() => setActiveTab(t.key)}
                >
                  <View
                    style={{
                      paddingVertical: 9,
                      paddingHorizontal: 16,
                      borderRadius: 999,
                      backgroundColor: selected
                        ? palette.text
                        : palette.surfaceAlt,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: "600",
                        color: selected ? palette.surface : palette.textMuted,
                        letterSpacing: 0.2,
                      }}
                    >
                      {t.label}
                    </Text>
                  </View>
                </TouchableBounce>
              );
            })}
          </ScrollView>
        </View>

        <View style={{ paddingHorizontal: 22, paddingBottom: 60 }}>
          {activeTab === "connection" && <ConnectionTab />}
          {activeTab === "models" && <ModelsTab />}
          {activeTab === "appearance" && <AppearanceTab />}
          {activeTab === "behaviour" && (
            <BehaviourTab
              scrollParentRef={scrollRef}
              scrollToY={scrollToY}
              pendingScrollTarget={pendingScrollTarget}
              onScrolledToTarget={handleScrolledToTarget}
            />
          )}
          {activeTab === "vault" && <VaultTab />}
          {activeTab === "budgeting" && (
            <BudgetingTab onGoToTelemetry={handleGoToTelemetry} />
          )}
          {activeTab === "logs" && telemetryEnabled && <LogsTab />}

          <View style={{ height: 40 }} />

          {hasChanges && (
            <GlassButton
              onPress={revert}
              style={{ borderRadius: 14, paddingVertical: 16, width: "100%" }}
            >
              <Text
                style={{
                  color: palette.danger,
                  fontWeight: "600",
                  fontSize: 15,
                  letterSpacing: 0.3,
                }}
              >
                Revert changes
              </Text>
            </GlassButton>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
