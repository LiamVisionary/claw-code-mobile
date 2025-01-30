import { Link } from "@/components/ui/Form";
import * as AC from "@bacons/apple-colors";
import { Image, ScrollView, Text, View } from "react-native";

import { IconSymbol } from "./ui/IconSymbol";
import Skeleton from "./ui/Skeleton";
import TouchableBounce from "./ui/TouchableBounce";

type ForecastDay = {
  date: string;
  day: {
    maxtemp_f: number;
    mintemp_f: number;
  };
  hour: Hour[];
};

type Hour = {
  time: string;
  temp_f: number;
  condition: {
    icon: string;
  };
};

type Location = {
  name: string;
  localtime: string;
};

type Current = {
  temp_f: number;
  feelslike_f: number;
};

type LocationData = {
  forecast: { forecastday: ForecastDay[] };
  location: Location;
  current: Current;
};

export async function getWeatherAsync(city: string): Promise<LocationData> {
  const response = await fetch(
    `http://api.weatherapi.com/v1/forecast.json?key=${process.env.WEATHER_API_KEY}&q=${city}&days=1&aqi=no&alerts=no`
  );
  return await response.json();
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

    const currentHour = new Date(data.location.localtime).getHours();
    const currentHourIndex = data.forecast.forecastday[0].hour.findIndex(
      (hour: any) => new Date(hour.time).getHours() === currentHour
    );
    return data.forecast.forecastday[0].hour.slice(currentHourIndex + 1);
  })();

  return (
    <View style={[styles.card, styles.weatherCard]}>
      <Link
        target="_blank"
        style={{ display: "flex" }}
        asChild={process.env.EXPO_OS !== "web"}
        href={`https://www.google.com/search?q=weather in ${city}`}
      >
        <TouchableBounce sensory style={{ flex: 1 }}>
          <View style={styles.upperContainer}>
            <View style={styles.tempContainer}>
              <View style={styles.tempRow}>
                <Text style={styles.tempText}>
                  {data?.current?.temp_f ?? "--"}°
                </Text>
                <Text style={styles.tempUnit}>F</Text>
              </View>
              <Text style={styles.cityText}>
                {data?.location?.name ?? city}
              </Text>
              <Text style={styles.feelsLikeText}>
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
            />
          </View>
        </TouchableBounce>
      </Link>

      <View style={styles.divider} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContainer}
      >
        {upcoming.length > 0
          ? upcoming.map((hour, index) => (
              <HourlyForecastItem key={index} hour={hour} index={index} />
            ))
          : Array.from({ length: 7 }).map((_, index) => (
              <HourlyForecastItem key={index} index={index} />
            ))}
      </ScrollView>
    </View>
  );
}

function HourlyForecastItem({ hour, index }: { hour?: Hour; index: number }) {
  return (
    <View style={styles.hourlyItem}>
      <Text style={[styles.hourlyText, index === 0 && styles.boldText]}>
        {index === 0
          ? "Now"
          : hour
          ? new Date(hour.time).toLocaleTimeString("en-US", { hour: "numeric" })
          : "--"}
      </Text>
      {hour && (
        <Image
          style={styles.hourlyImage}
          source={{ uri: `https:${hour.condition.icon}` }}
        />
      )}
      {!hour && (
        <Skeleton
          style={[styles.hourlyImage, { borderRadius: 999, opacity: 0.1 }]}
          dark={false}
        />
      )}
      <Text style={styles.hourlyTemp}>{hour?.temp_f ?? "--"}°</Text>
    </View>
  );
}

const backgroundImage =
  process.env.EXPO_OS === "web"
    ? `backgroundImage`
    : `experimental_backgroundImage`;

const styles = {
  card: {
    margin: 16,
    padding: 16,
    borderRadius: 16,
    borderCurve: "continuous",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.29,
    shadowRadius: 4.65,
    elevation: 7,
  },
  weatherCard: {
    gap: 12,
    [backgroundImage]:
      "linear-gradient(180deg,#1D1E30, #272742, #343F5A,#3B4A64)",
  },
  upperContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  tempContainer: {
    gap: 2,
  },
  tempRow: {
    flexDirection: "row",
    gap: 6,
  },
  tempText: {
    fontSize: 30,
    color: AC.label,
    fontWeight: "bold",
  },
  tempUnit: {
    color: AC.label,
    fontSize: 16,
    marginTop: 4,
  },
  cityText: {
    fontSize: 24,
    color: AC.label,
    marginBottom: 6,
  },
  feelsLikeText: {
    color: AC.secondaryLabel,
    fontSize: 16,
  },
  divider: {
    height: 0.5,
    opacity: 0.3,
    backgroundColor: AC.label,
  },
  scrollContainer: {
    gap: 8,
  },
  hourlyItem: {
    alignItems: "center",
    gap: 4,
  },
  hourlyText: {
    color: AC.label,
    fontSize: 12,
  },
  boldText: {
    fontWeight: "bold",
  },
  hourlyImage: {
    width: 48,
    height: 48,
    aspectRatio: 1,
  },
  hourlyTemp: {
    color: AC.label,
    fontSize: 16,
  },
} as const;
