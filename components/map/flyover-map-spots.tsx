"use client";
import {
  Image,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { FlyoverMap } from "./flyover-map";
import { useState, useId, useRef, useEffect } from "react";
import { BlurView } from "expo-blur";
import type { AI } from "../ai-context";
import { useUIState, useAIState } from "ai/rsc";
import TouchableBounce from "@/components/ui/TouchableBounce";
import { Suggestions } from "../suggestions";

const useWebOnScroll = ({
  onScroll,
  onScrollEnd,
}: {
  onScroll: React.ComponentProps<typeof ScrollView>["onScroll"];
  onScrollEnd: () => void;
}) => {
  const lastScrollEvent = useRef(null);
  const scrollEndTimeout = useRef(null);

  const handleWebScroll = (event) => {
    onScroll?.(event);

    const timestamp = Date.now();

    if (scrollEndTimeout.current) {
      clearTimeout(scrollEndTimeout.current);
    }

    if (lastScrollEvent.current) {
      // Scroll ended
      scrollEndTimeout.current = setTimeout(() => {
        if (lastScrollEvent.current === timestamp) {
          lastScrollEvent.current = null;
          onScrollEnd && onScrollEnd(event);
        }
      }, 500);
    }

    lastScrollEvent.current = timestamp;
  };

  useEffect(() => {
    return () => {
      scrollEndTimeout.current && clearTimeout(scrollEndTimeout.current);
    };
  }, []);

  return handleWebScroll;
};

export function FlyoverCard({
  locations,
}: {
  locations: {
    icon: string;
    title: string;
    latitude: number;
    longitude: number;
    altitude?: number;
    rating: number;
  }[];
}) {
  const [location, setLocation] = useState(locations[0]);
  const [width, setWidth] = useState(0);
  // const [aiState, setAIState] = useAIState<typeof AI>();
  // const [messages, setMessages] = useUIState<typeof AI>();

  const handleWebScroll = useWebOnScroll({
    onScrollEnd(event) {
      if (process.env.EXPO_OS !== "web") return;
      console.log("onScrollAnimationEnd", event.nativeEvent);
      const index = Math.round(event.nativeEvent.contentOffset.x / width);
      const nextLocation = locations[index];
      console.log(nextLocation.title);
      if (nextLocation.title !== location.title) {
        setLocation(nextLocation);
      }
    },
  });

  // const id = useId();
  return (
    <View
      onLayout={(event) => {
        setWidth(event.nativeEvent.layout.width);
      }}
      style={{
        flex: 1,
        minHeight: 360,
        maxHeight: 360,
      }}
    >
      {/* {location && <View style={{ flex: 1, backgroundColor: "blue" }} />} */}
      {location && (
        <FlyoverMap
          center={location}
          altitude={process.env.EXPO_OS === "web" ? 1000 : 500}
        />
      )}
      <ScrollView
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 96,
        }}
        scrollEventThrottle={16}
        onScroll={Platform.select({
          web: handleWebScroll,
          default: undefined,
        })}
        onMomentumScrollEnd={(event) => {
          const index = Math.round(event.nativeEvent.contentOffset.x / width);
          const nextLocation = locations[index];
          console.log(nextLocation.title);
          if (nextLocation.title !== location.title) {
            setLocation(nextLocation);
          }
        }}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: 24,
        }}
      >
        {locations.map((value, index) => (
          <View
            key={index}
            style={{
              backgroundColor: "transparent",
              flex: 1,
              width,
              paddingHorizontal: 16,
            }}
          >
            <TouchableBounce
              style={{
                flex: 1,
              }}
              onPress={() => {
                // const coord = JSON.stringify({
                //   latitude: value.latitude,
                //   longitude: value.longitude,
                // });
                // const info = {
                //   role: "assistant" as const,
                //   content: `[User has selected location "${value.title}" at coordinate "${coord}"]`,
                //   // Identifier of this UI component, so we don't insert it many times.
                //   // id,
                // };
                // console.log(info);
                // // If the last message is already inserted by us, update it. This is to avoid
                // // adding every slider change to the AI state.
                // if (aiState[aiState.length - 1]?.id === id) {
                //   setAIState([...aiState.slice(0, -1), info]);
                // } else {
                //   // If it doesn't exist, append it to the AI state.
                //   setAIState([...aiState, info]);
                //   setMessages((messages) => [
                //     ...messages,
                //     {
                //       display: (
                //         <View key={String(id)} style={{ paddingHorizontal: 16 }}>
                //           {/* <AssistantMessage key={String(id)}>{info.content}</AssistantMessage> */}
                //           <Suggestions
                //             suggestions={[
                //               "Get the weather",
                //               // 'Show me pictures',
                //               "Book an Uber",
                //             ]}
                //           />
                //         </View>
                //       ),
                //       id,
                //     },
                //   ]);
                // }
              }}
            >
              <BlurView
                experimentalBlurMethod="dimezisBlurView"
                tint="systemMaterialDark"
                style={{
                  //   backgroundColor: '#191A20',
                  borderRadius: 10,
                  borderCurve: "continuous",
                  width: width - 32,
                  overflow: "hidden",
                  padding: 16,
                  justifyContent: "center",
                }}
              >
                <View
                  style={{
                    gap: 8,
                    flexDirection: "row",
                    alignItems: "center",
                  }}
                >
                  <View
                    style={{
                      width: 48,
                      justifyContent: "center",
                      alignItems: "center",
                      aspectRatio: 1,
                      borderRadius: 999,
                      backgroundColor: "#353745",
                      padding: 12,
                    }}
                  >
                    <Image
                      source={{ uri: value.icon }}
                      resizeMode="contain"
                      style={{
                        tintColor: "#EDEEE9",
                        flex: 1,
                        aspectRatio: 1,
                      }}
                    />
                  </View>

                  <Text
                    numberOfLines={1}
                    style={{
                      maxWidth: "90%",
                      color: "#EDEEE9",
                      flexWrap: "wrap",
                      paddingRight: 16,
                      fontSize: 16,
                      fontWeight: "bold",
                    }}
                  >
                    {value.title}
                  </Text>

                  {/* <Text style={{ color: '#EDEEE9', fontSize: 12, fontWeight: 'bold' }}>
                {value.rating}★
              </Text> */}
                </View>
              </BlurView>
            </TouchableBounce>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
