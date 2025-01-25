import * as Form from "@/components/ui/Form";
import * as AC from "@bacons/apple-colors";
import { Image, ScrollView, Text, View } from "react-native";

import { IconSymbol } from "./ui/IconSymbol";
import TouchableBounce from "./ui/TouchableBounce";

type LocationData = { forecast: any; location: any; current: any };

export async function getWeatherAsync(city: string): Promise<LocationData> {
  const data = await fetch(
    `http://api.weatherapi.com/v1/forecast.json?key=${process.env.WEATHER_API_KEY}&q=${city}&days=1&aqi=no&alerts=no`
  ).then((res) => res.json());

  return data;
}

function Card({ children, style }: any) {
  return (
    <View
      style={{
        margin: 16,
        padding: 16,
        borderRadius: 16,
        borderCurve: "continuous",
        shadowOffset: {
          width: 0,
          height: 3,
        },
        shadowOpacity: 0.29,
        shadowRadius: 4.65,
        elevation: 7,
        ...style,
      }}
    >
      {children}
    </View>
  );
}

export function WeatherCard({
  city,
  data,
}: {
  city: string;
  data?: LocationData;
}) {
  const upcoming = (() => {
    if (!data) return [];
    // current hour on...
    const currentHour = new Date(data.location.localtime).getHours();
    const currentHourIndex = data.forecast.forecastday[0].hour.findIndex(
      (hour: any) => new Date(hour.time).getHours() === currentHour
    );
    return data.forecast.forecastday[0].hour.slice(currentHourIndex + 1);
  })();
  return (
    <Card
      style={{
        gap: 12,
        [process.env.EXPO_OS === "web"
          ? `backgroundImage`
          : `experimental_backgroundImage`]:
          "linear-gradient(180deg,#1D1E30, #272742, #343F5A,#3B4A64)",
      }}
    >
      {/* Upper */}
      <Form.Link
        target="_blank"
        asChild
        href={`https://www.google.com/search?q=${"weather in " + city}`}
      >
        <TouchableBounce sensory>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
            }}
          >
            <View style={{ gap: 2 }}>
              <View
                style={{
                  flexDirection: "row",
                  gap: 6,
                }}
              >
                <Text
                  style={{
                    fontSize: 30,
                    color: AC.label,
                    fontWeight: "bold",
                  }}
                >
                  {data?.current?.temp_f ?? "--"}°
                </Text>
                <Text
                  style={{
                    color: AC.label,
                    fontSize: 16,
                    marginTop: 4,
                  }}
                >
                  F
                </Text>
              </View>

              {/*  */}

              <Text
                style={{
                  fontSize: 24,
                  color: AC.label,
                  marginBottom: 6,
                }}
              >
                {data?.location?.name ?? city}
              </Text>
              {/* 30° / 21° Feels like 43° */}
              <Text
                style={{
                  color: AC.secondaryLabel,
                  fontSize: 16,
                }}
              >
                <Text>
                  {data?.forecast?.forecastday[0].day.maxtemp_f ?? "--"}
                </Text>{" "}
                /{" "}
                <Text>
                  {data?.forecast?.forecastday[0].day.mintemp_f ?? "--"}
                </Text>{" "}
                Feels like <Text>{data?.current?.feelslike_f ?? "--"}</Text>
              </Text>
            </View>

            <IconSymbol
              name="ellipsis.circle.fill"
              color={AC.systemGray}
              size={24}
            ></IconSymbol>
          </View>
        </TouchableBounce>
      </Form.Link>

      <View>
        <View
          style={{
            height: 0.5,
            opacity: 0.3,
            backgroundColor: AC.label,
          }}
        />
      </View>

      <ScrollView
        horizontal
        style={{}}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: 8,
        }}
      >
        {upcoming.map((hour: any, index: number) => (
          <HourlyForecastItem hour={hour} index={index} />
        ))}
        {!upcoming.length && (
          <>
            <HourlyForecastItem index={1} />
            <HourlyForecastItem index={1} />
            <HourlyForecastItem index={1} />
            <HourlyForecastItem index={1} />
            <HourlyForecastItem index={1} />
            <HourlyForecastItem index={1} />
            <HourlyForecastItem index={1} />
          </>
        )}
      </ScrollView>
    </Card>
  );
}

function HourlyForecastItem({
  hour,
  index,
}: {
  hour?: { time: string; condition: any; temp_f: number };
  index: number;
}) {
  return (
    <View key={index} style={{ alignItems: "center", gap: 4 }}>
      <Text
        style={{
          color: AC.label,
          fontSize: 12,
          fontWeight: index === 0 ? "bold" : "normal",
        }}
      >
        {index === 0
          ? "Now"
          : hour
          ? new Date(hour.time).toLocaleTimeString("en-US", {
              hour: "numeric",
            })
          : "--"}
      </Text>

      <Image
        style={{
          width: 48,
          height: 48,
          aspectRatio: 1,
        }}
        source={hour ? { uri: `https:${hour.condition.icon}` } : undefined}
      />

      <Text
        style={{
          color: AC.label,
          fontSize: 16,
        }}
      >
        {hour?.temp_f ?? "--"}°
      </Text>
    </View>
  );
}
