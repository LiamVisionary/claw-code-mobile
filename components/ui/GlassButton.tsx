import { GlassView } from "expo-glass-effect";
import { StyleProp, ViewStyle } from "react-native";
import TouchableBounce from "@/components/ui/TouchableBounce";

/**
 * A pressable pill with the iOS 26 liquid glass effect.
 * Falls back to a plain View on older iOS. Wraps TouchableBounce
 * for haptic feedback + spring animation, with GlassView providing
 * the specular-highlight material.
 */
export function GlassButton({
  onPress,
  disabled,
  style,
  tintColor,
  children,
}: {
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  tintColor?: string;
  children: React.ReactNode;
}) {
  return (
    <TouchableBounce sensory onPress={onPress} disabled={disabled}>
      <GlassView
        glassEffectStyle="regular"
        isInteractive
        tintColor={tintColor}
        style={[
          {
            alignItems: "center" as const,
            justifyContent: "center" as const,
            overflow: "hidden" as const,
          },
          style,
        ]}
      >
        {children}
      </GlassView>
    </TouchableBounce>
  );
}
