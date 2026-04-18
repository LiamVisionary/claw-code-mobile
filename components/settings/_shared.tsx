import React from "react";
import {
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import { usePalette } from "@/hooks/usePalette";
import { type Palette } from "@/constants/palette";

export const makeId = () =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

export function isDarkPalette(p: Palette): boolean {
  const hex = p.bg.replace("#", "");
  if (hex.length < 6) return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r + g + b) / 3 < 128;
}

export function SectionHeader({ title }: { title: string }) {
  const palette = usePalette();
  return (
    <Text
      style={{
        color: palette.textMuted,
        fontSize: 12,
        fontWeight: "600",
        letterSpacing: 1.4,
        textTransform: "uppercase",
        marginBottom: 14,
        marginLeft: 4,
      }}
    >
      {title}
    </Text>
  );
}

export function Hairline({ inset = 0 }: { inset?: number }) {
  const palette = usePalette();
  return (
    <View
      style={{
        height: 1,
        backgroundColor: palette.divider,
        marginLeft: inset,
      }}
    />
  );
}

export function Caption({ children }: { children: React.ReactNode }) {
  const palette = usePalette();
  return (
    <Text
      style={{
        color: palette.textMuted,
        fontSize: 13,
        lineHeight: 19,
        marginTop: 10,
        marginLeft: 4,
        marginRight: 4,
      }}
    >
      {children}
    </Text>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const palette = usePalette();
  const selectedIndex = options.findIndex((o) => o.key === value);
  return (
    <SegmentedControl
      values={options.map((o) => o.label)}
      selectedIndex={selectedIndex >= 0 ? selectedIndex : 0}
      onChange={(e) => {
        const idx = e.nativeEvent.selectedSegmentIndex;
        if (options[idx]) onChange(options[idx].key);
      }}
      appearance={isDarkPalette(palette) ? "dark" : "light"}
    />
  );
}

export function Field({
  placeholder,
  value,
  onChangeText,
  secureTextEntry,
  keyboardType,
  autoCapitalize = "none",
  onSubmitEditing,
  onEndEditing,
  returnKeyType,
}: {
  placeholder: string;
  value: string;
  onChangeText: (s: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "url" | "email-address" | "number-pad";
  autoCapitalize?: "none" | "sentences";
  onSubmitEditing?: () => void;
  onEndEditing?: () => void;
  returnKeyType?: "done" | "go" | "next" | "search" | "send";
}) {
  const palette = usePalette();
  return (
    <TextInput
      placeholder={placeholder}
      placeholderTextColor={palette.textSoft}
      value={value}
      onChangeText={onChangeText}
      autoCapitalize={autoCapitalize}
      keyboardType={keyboardType}
      secureTextEntry={secureTextEntry}
      onSubmitEditing={onSubmitEditing}
      onEndEditing={onEndEditing}
      returnKeyType={returnKeyType}
      blurOnSubmit
      style={{
        backgroundColor: palette.surfaceAlt,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        color: palette.text,
        fontSize: 15,
        fontWeight: "500",
      }}
    />
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  const palette = usePalette();
  return (
    <View
      style={{
        backgroundColor: palette.surface,
        borderRadius: 16,
      }}
    >
      {children}
    </View>
  );
}

export function ToggleRow({
  title,
  description,
  value,
  onValueChange,
}: {
  title: string;
  description: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  const palette = usePalette();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 16,
        paddingHorizontal: 20,
        gap: 14,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: palette.text,
            fontSize: 15,
            fontWeight: "600",
            letterSpacing: 0.1,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            color: palette.textMuted,
            fontSize: 13,
            marginTop: 4,
            lineHeight: 18,
          }}
        >
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: palette.text, false: palette.surfaceAlt }}
        thumbColor={palette.surface}
        ios_backgroundColor={palette.surfaceAlt}
      />
    </View>
  );
}
