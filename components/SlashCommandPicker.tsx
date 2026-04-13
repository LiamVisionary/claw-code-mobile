import { useEffect, useRef } from "react";
import {
  Animated,
  Platform,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import * as AC from "@bacons/apple-colors";
import { IconSymbol, type IconSymbolName } from "@/components/ui/IconSymbol";
import { BORDER_RADIUS, SHADOW, SPACING, TYPOGRAPHY } from "@/constants/theme";

export interface SlashCommand {
  command: string;
  icon: IconSymbolName;
  desc: string;
  /** Optional suffix appended after the command (e.g. a space) */
  suffix?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: "/compact",
    icon: "arrow.triangle.2.circlepath",
    desc: "Summarize conversation to free up context",
  },
  {
    command: "/ls",
    icon: "folder",
    desc: "List files in working directory",
  },
  {
    command: "/git status",
    icon: "arrow.triangle.branch",
    desc: "Show git working tree status",
  },
  {
    command: "/diff",
    icon: "arrow.left.arrow.right",
    desc: "Show uncommitted changes",
  },
  {
    command: "/pwd",
    icon: "location",
    desc: "Show current working directory",
  },
  {
    command: "/help",
    icon: "questionmark.circle",
    desc: "List available tools and commands",
  },
];

interface Props {
  /** The raw value of the TextInput (must start with "/") */
  inputValue: string;
  visible: boolean;
  onSelect: (command: string) => void;
}

export default function SlashCommandPicker({ inputValue, visible, onSelect }: Props) {
  const isDark = useColorScheme() === "dark";
  const anim = useRef(new Animated.Value(0)).current;

  const query = inputValue.startsWith("/") ? inputValue.slice(1).toLowerCase() : "";
  const matches = SLASH_COMMANDS.filter(
    (c) =>
      c.command.slice(1).startsWith(query) ||
      c.desc.toLowerCase().includes(query)
  );

  useEffect(() => {
    Animated.spring(anim, {
      toValue: visible && matches.length > 0 ? 1 : 0,
      useNativeDriver: true,
      tension: 280,
      friction: 24,
    }).start();
  }, [visible, matches.length]);

  if (!visible || matches.length === 0) return null;

  const cardBg = isDark ? "#1c1c1e" : "#ffffff";
  const divider = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";

  return (
    <Animated.View
      style={{
        marginHorizontal: SPACING.lg,
        marginBottom: SPACING.xs,
        opacity: anim,
        transform: [
          {
            translateY: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [8, 0],
            }),
          },
        ],
        borderRadius: BORDER_RADIUS.lg,
        overflow: "hidden",
        backgroundColor: cardBg,
        borderWidth: 1,
        borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
        ...SHADOW.lg,
      }}
    >
      {matches.map((item, idx) => {
        const [cmd, ...rest] = item.command.split(" ");
        const suffix = rest.length ? " " + rest.join(" ") : "";
        const queryLen = inputValue.length - 1;
        const highlighted = cmd.slice(0, 1 + queryLen);
        const remaining = cmd.slice(1 + queryLen);
        return (
          <TouchableOpacity
            key={item.command}
            activeOpacity={0.7}
            onPress={() => onSelect(item.command)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: SPACING.sm,
              paddingHorizontal: SPACING.md,
              paddingVertical: 10,
              borderBottomWidth: idx < matches.length - 1 ? 1 : 0,
              borderBottomColor: divider,
            }}
          >
            {/* Icon pill */}
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: BORDER_RADIUS.sm,
                backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <IconSymbol name={item.icon} size={14} color={AC.systemBlue} />
            </View>

            {/* Command name + description */}
            <View style={{ flex: 1, gap: 1 }}>
              <Text
                style={{
                  fontSize: TYPOGRAPHY.fontSizes.sm,
                  fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                }}
                numberOfLines={1}
              >
                {/* Highlight the already-typed portion */}
                <Text style={{ color: AC.systemBlue, fontWeight: "700" }}>
                  {highlighted}
                </Text>
                <Text style={{ color: AC.label, fontWeight: "500" }}>
                  {remaining}
                </Text>
                {suffix ? (
                  <Text style={{ color: AC.systemGray }}>{suffix}</Text>
                ) : null}
              </Text>
              <Text
                style={{
                  fontSize: TYPOGRAPHY.fontSizes.xs,
                  color: AC.systemGray,
                  lineHeight: TYPOGRAPHY.lineHeights.xs,
                }}
                numberOfLines={1}
              >
                {item.desc}
              </Text>
            </View>

            {/* Tab hint */}
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 4,
                backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
              }}
            >
              <Text style={{ color: AC.systemGray3, fontSize: 10 }}>tap</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </Animated.View>
  );
}
