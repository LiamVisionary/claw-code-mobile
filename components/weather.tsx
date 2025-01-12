import * as Form from "@/components/ui/Form";
import * as AC from "@bacons/apple-colors";
import { Image, ScrollView, Text, View } from "react-native";

import { SubtleScaleAndFadeIn } from "./external-link";
import { IconSymbol } from "./ui/IconSymbol";
import Skeleton from "./ui/Skeleton";
import TouchableBounce from "./ui/TouchableBounce";

// import { SubtleScaleAndFadeIn } from "@/components/external-link";
// import Skeleton from "@/components/skeleton";
// import { LocationData } from "./weather.types";

type LocationData = any;

export async function getWeatherAsync(city: string): Promise<LocationData> {
  const data = await fetch(
    `http://api.weatherapi.com/v1/forecast.json?key=${process.env.WEATHER_API_KEY}&q=${city}&days=1&aqi=no&alerts=no`
  ).then((res) => res.json());

  return data;
}

function Card({ title, children, style }: any) {
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

export function WeatherSkeleton() {
  return (
    <SubtleScaleAndFadeIn style={{ flex: 1 }}>
      <Card title="Fetching...">
        {/* Upper */}
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View style={{ gap: 8 }}>
            <Skeleton style={{ width: 60, height: 40, borderRadius: 666 }} />
            {/* Current temp in F */}
            <View
              style={{
                flexDirection: "row",
                gap: 8,
                alignItems: "center",
              }}
            >
              <Skeleton
                style={{
                  width: 24,
                  minHeight: 24,
                  height: 24,
                  borderRadius: 666,
                }}
              />
              <Skeleton
                style={{
                  width: 96,
                  minHeight: 24,
                  height: 24,
                  borderRadius: 8,
                }}
              />
            </View>
          </View>

          <Skeleton style={{ width: 80, height: 80, borderRadius: 666 }} />
        </View>

        {/* Lower */}
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View style={{ gap: 6 }}>
            {/* 30° / 21° Feels like 43° */}
            <Skeleton
              style={{ width: 180, minHeight: 24, height: 24, borderRadius: 8 }}
            />

            {/* Wed, 2:39 pm */}
            <Skeleton
              style={{
                width: 96,
                minHeight: 24,
                height: 24,
                borderRadius: 666,
              }}
            />
          </View>

          {/*  */}
          <View style={{ gap: 2, alignItems: "flex-start" }}>
            {/* Sunrise time */}
            <View
              style={{
                flexDirection: "row",
                gap: 8,
                alignItems: "center",
                justifyContent: "space-between",
                flex: 1,
              }}
            >
              <Skeleton
                style={{
                  width: 24,
                  maxHeight: 24,
                  minHeight: 24,
                  borderRadius: 12,
                }}
              />
              <Skeleton
                style={{
                  width: 56,
                  maxHeight: 24,
                  minHeight: 24,
                  borderRadius: 8,
                }}
              />
            </View>
            {/* Sunset time */}
            <View
              style={{
                flexDirection: "row",
                gap: 8,
                alignItems: "center",
                justifyContent: "space-between",
                flex: 1,
              }}
            >
              <Skeleton
                style={{
                  width: 24,
                  maxHeight: 24,
                  minHeight: 24,
                  borderRadius: 12,
                }}
              />
              <Skeleton
                style={{
                  width: 56,
                  maxHeight: 24,
                  minHeight: 24,
                  borderRadius: 8,
                }}
              />
            </View>
          </View>
        </View>
        {/*  */}
        <Skeleton
          style={{ width: 56, maxHeight: 36, minHeight: 36, borderRadius: 666 }}
        />
      </Card>
    </SubtleScaleAndFadeIn>
  );
}

export function WeatherCard({
  city,
  data,
}: {
  city: string;
  data: LocationData;
}) {
  // current hour on...
  const currentHour = new Date(data.location.localtime).getHours();
  const currentHourIndex = data.forecast.forecastday[0].hour.findIndex(
    (hour: any) => new Date(hour.time).getHours() === currentHour
  );
  const upcoming = data.forecast.forecastday[0].hour.slice(
    currentHourIndex + 1
  );

  return (
    <Card
      style={{
        backgroundColor: "white",
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
        <TouchableBounce>
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
                  {data.current.temp_f}°
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
                {/* <Text
                  style={{
                    color: AC.label,
                    fontSize: 16,
                    opacity: 0.5,
                  }}
                >
                  C
                </Text> */}
              </View>

              {/*  */}

              <Text
                style={{
                  fontSize: 24,
                  color: AC.label,
                  marginBottom: 6,
                }}
              >
                {data.location.name}
              </Text>
              {/* 30° / 21° Feels like 43° */}
              <Text
                style={{
                  color: AC.secondaryLabel,
                  fontSize: 16,
                }}
              >
                <Text>{data.forecast.forecastday[0].day.maxtemp_f}</Text> /{" "}
                <Text>{data.forecast.forecastday[0].day.mintemp_f}</Text> Feels
                like <Text>{data.current.feelslike_f}</Text>
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
                : new Date(hour.time).toLocaleTimeString("en-US", {
                    hour: "numeric",
                  })}
            </Text>
            <Image
              style={{
                width: 48,
                height: 48,
                aspectRatio: 1,
              }}
              source={{ uri: `https:${hour.condition.icon}` }}
            />
            <Text
              style={{
                color: AC.label,
                fontSize: 16,
              }}
            >
              {hour.temp_f}°
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* <SwitchDegreesSwitch /> */}
    </Card>
  );
}

const Colors = {
  navy: "#102151",
  gray: "#686F81",
};

export const MOCK_AUSTIN_WEATHER_DATA = {
  location: {
    name: "Austin",
    region: "Texas",
    country: "United States of America",
    lat: 30.2669,
    lon: -97.7428,
    tz_id: "America/Chicago",
    localtime_epoch: 1736703892,
    localtime: "2025-01-12 11:44",
  },
  current: {
    last_updated_epoch: 1736703000,
    last_updated: "2025-01-12 11:30",
    temp_c: 11.8,
    temp_f: 53.2,
    is_day: 1,
    condition: {
      text: "Sunny",
      icon: "//cdn.weatherapi.com/weather/64x64/day/113.png",
      code: 1000,
    },
    wind_mph: 6.3,
    wind_kph: 10.1,
    wind_degree: 303,
    wind_dir: "WNW",
    pressure_mb: 1017,
    pressure_in: 30.03,
    precip_mm: 0,
    precip_in: 0,
    humidity: 44,
    cloud: 0,
    feelslike_c: 10.8,
    feelslike_f: 51.4,
    windchill_c: 7.5,
    windchill_f: 45.6,
    heatindex_c: 9.1,
    heatindex_f: 48.4,
    dewpoint_c: 1.7,
    dewpoint_f: 35.1,
    vis_km: 16,
    vis_miles: 9,
    uv: 3,
    gust_mph: 7.7,
    gust_kph: 12.5,
  },
  forecast: {
    forecastday: [
      {
        date: "2025-01-12",
        date_epoch: 1736640000,
        day: {
          maxtemp_c: 15.2,
          maxtemp_f: 59.4,
          mintemp_c: 1.9,
          mintemp_f: 35.4,
          avgtemp_c: 7.9,
          avgtemp_f: 46.2,
          maxwind_mph: 13.9,
          maxwind_kph: 22.3,
          totalprecip_mm: 0,
          totalprecip_in: 0,
          totalsnow_cm: 0,
          avgvis_km: 10,
          avgvis_miles: 6,
          avghumidity: 63,
          daily_will_it_rain: 0,
          daily_chance_of_rain: 0,
          daily_will_it_snow: 0,
          daily_chance_of_snow: 0,
          condition: {
            text: "Sunny",
            icon: "//cdn.weatherapi.com/weather/64x64/day/113.png",
            code: 1000,
          },
          uv: 0.8,
        },
        astro: {
          sunrise: "07:29 AM",
          sunset: "05:51 PM",
          moonrise: "04:36 PM",
          moonset: "06:36 AM",
          moon_phase: "Waxing Gibbous",
          moon_illumination: 95,
          is_moon_up: 1,
          is_sun_up: 0,
        },
        hour: [
          {
            time_epoch: 1736661600,
            time: "2025-01-12 00:00",
            temp_c: 4.6,
            temp_f: 40.3,
            is_day: 0,
            condition: {
              text: "Clear ",
              icon: "//cdn.weatherapi.com/weather/64x64/night/113.png",
              code: 1000,
            },
            wind_mph: 8.1,
            wind_kph: 13,
            wind_degree: 185,
            wind_dir: "S",
            pressure_mb: 1014,
            pressure_in: 29.94,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 66,
            cloud: 0,
            feelslike_c: 1.3,
            feelslike_f: 34.4,
            windchill_c: 1.3,
            windchill_f: 34.4,
            heatindex_c: 4.6,
            heatindex_f: 40.3,
            dewpoint_c: -1.3,
            dewpoint_f: 29.6,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 14.9,
            gust_kph: 23.9,
            uv: 0,
          },
          {
            time_epoch: 1736665200,
            time: "2025-01-12 01:00",
            temp_c: 4.1,
            temp_f: 39.3,
            is_day: 0,
            condition: {
              text: "Clear ",
              icon: "//cdn.weatherapi.com/weather/64x64/night/113.png",
              code: 1000,
            },
            wind_mph: 8.1,
            wind_kph: 13,
            wind_degree: 194,
            wind_dir: "SSW",
            pressure_mb: 1014,
            pressure_in: 29.94,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 70,
            cloud: 0,
            feelslike_c: 0.7,
            feelslike_f: 33.3,
            windchill_c: 0.7,
            windchill_f: 33.3,
            heatindex_c: 4.1,
            heatindex_f: 39.3,
            dewpoint_c: -1,
            dewpoint_f: 30.2,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 15,
            gust_kph: 24.1,
            uv: 0,
          },
          {
            time_epoch: 1736668800,
            time: "2025-01-12 02:00",
            temp_c: 3.6,
            temp_f: 38.5,
            is_day: 0,
            condition: {
              text: "Clear ",
              icon: "//cdn.weatherapi.com/weather/64x64/night/113.png",
              code: 1000,
            },
            wind_mph: 7.8,
            wind_kph: 12.6,
            wind_degree: 192,
            wind_dir: "SSW",
            pressure_mb: 1014,
            pressure_in: 29.93,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 74,
            cloud: 0,
            feelslike_c: 0.5,
            feelslike_f: 32.9,
            windchill_c: 0.5,
            windchill_f: 32.9,
            heatindex_c: 3.6,
            heatindex_f: 38.5,
            dewpoint_c: -0.7,
            dewpoint_f: 30.8,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 14.5,
            gust_kph: 23.4,
            uv: 0,
          },
          {
            time_epoch: 1736672400,
            time: "2025-01-12 03:00",
            temp_c: 3.2,
            temp_f: 37.7,
            is_day: 0,
            condition: {
              text: "Clear ",
              icon: "//cdn.weatherapi.com/weather/64x64/night/113.png",
              code: 1000,
            },
            wind_mph: 7.2,
            wind_kph: 11.5,
            wind_degree: 198,
            wind_dir: "SSW",
            pressure_mb: 1014,
            pressure_in: 29.93,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 77,
            cloud: 0,
            feelslike_c: 0.7,
            feelslike_f: 33.2,
            windchill_c: 0.7,
            windchill_f: 33.2,
            heatindex_c: 3.2,
            heatindex_f: 37.7,
            dewpoint_c: -0.5,
            dewpoint_f: 31.1,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 13.7,
            gust_kph: 22.1,
            uv: 0,
          },
          {
            time_epoch: 1736676000,
            time: "2025-01-12 04:00",
            temp_c: 2.9,
            temp_f: 37.2,
            is_day: 0,
            condition: {
              text: "Clear ",
              icon: "//cdn.weatherapi.com/weather/64x64/night/113.png",
              code: 1000,
            },
            wind_mph: 6,
            wind_kph: 9.7,
            wind_degree: 201,
            wind_dir: "SSW",
            pressure_mb: 1012,
            pressure_in: 29.89,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 83,
            cloud: 0,
            feelslike_c: 1.1,
            feelslike_f: 33.9,
            windchill_c: 1.1,
            windchill_f: 33.9,
            heatindex_c: 2.9,
            heatindex_f: 37.2,
            dewpoint_c: 0.2,
            dewpoint_f: 32.3,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 11.7,
            gust_kph: 18.9,
            uv: 0,
          },
          {
            time_epoch: 1736679600,
            time: "2025-01-12 05:00",
            temp_c: 2.7,
            temp_f: 36.8,
            is_day: 0,
            condition: {
              text: "Clear ",
              icon: "//cdn.weatherapi.com/weather/64x64/night/113.png",
              code: 1000,
            },
            wind_mph: 5.4,
            wind_kph: 8.6,
            wind_degree: 205,
            wind_dir: "SSW",
            pressure_mb: 1013,
            pressure_in: 29.91,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 84,
            cloud: 0,
            feelslike_c: 1.4,
            feelslike_f: 34.5,
            windchill_c: 1.4,
            windchill_f: 34.5,
            heatindex_c: 2.7,
            heatindex_f: 36.8,
            dewpoint_c: 0.1,
            dewpoint_f: 32.3,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 10.9,
            gust_kph: 17.5,
            uv: 0,
          },
          {
            time_epoch: 1736683200,
            time: "2025-01-12 06:00",
            temp_c: 2.4,
            temp_f: 36.3,
            is_day: 0,
            condition: {
              text: "Clear ",
              icon: "//cdn.weatherapi.com/weather/64x64/night/113.png",
              code: 1000,
            },
            wind_mph: 4.9,
            wind_kph: 7.9,
            wind_degree: 224,
            wind_dir: "SW",
            pressure_mb: 1013,
            pressure_in: 29.91,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 86,
            cloud: 0,
            feelslike_c: 1.8,
            feelslike_f: 35.2,
            windchill_c: 1.8,
            windchill_f: 35.2,
            heatindex_c: 2.4,
            heatindex_f: 36.3,
            dewpoint_c: 0.5,
            dewpoint_f: 32.8,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 10.2,
            gust_kph: 16.3,
            uv: 0,
          },
          {
            time_epoch: 1736686800,
            time: "2025-01-12 07:00",
            temp_c: 2.1,
            temp_f: 35.9,
            is_day: 0,
            condition: {
              text: "Clear ",
              icon: "//cdn.weatherapi.com/weather/64x64/night/113.png",
              code: 1000,
            },
            wind_mph: 4.3,
            wind_kph: 6.8,
            wind_degree: 248,
            wind_dir: "WSW",
            pressure_mb: 1013,
            pressure_in: 29.91,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 89,
            cloud: 0,
            feelslike_c: 0.8,
            feelslike_f: 33.5,
            windchill_c: 0.8,
            windchill_f: 33.5,
            heatindex_c: 2.1,
            heatindex_f: 35.9,
            dewpoint_c: 0.4,
            dewpoint_f: 32.8,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 8.9,
            gust_kph: 14.4,
            uv: 0,
          },
          {
            time_epoch: 1736690400,
            time: "2025-01-12 08:00",
            temp_c: 2.2,
            temp_f: 36,
            is_day: 1,
            condition: {
              text: "Sunny",
              icon: "//cdn.weatherapi.com/weather/64x64/day/113.png",
              code: 1000,
            },
            wind_mph: 4.7,
            wind_kph: 7.6,
            wind_degree: 280,
            wind_dir: "W",
            pressure_mb: 1014,
            pressure_in: 29.95,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 87,
            cloud: 0,
            feelslike_c: 0.2,
            feelslike_f: 32.4,
            windchill_c: 0.2,
            windchill_f: 32.4,
            heatindex_c: 2.2,
            heatindex_f: 36,
            dewpoint_c: -0.1,
            dewpoint_f: 31.9,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 9.6,
            gust_kph: 15.4,
            uv: 0.2,
          },
          {
            time_epoch: 1736694000,
            time: "2025-01-12 09:00",
            temp_c: 3.6,
            temp_f: 38.5,
            is_day: 1,
            condition: {
              text: "Sunny",
              icon: "//cdn.weatherapi.com/weather/64x64/day/113.png",
              code: 1000,
            },
            wind_mph: 4,
            wind_kph: 6.5,
            wind_degree: 291,
            wind_dir: "WNW",
            pressure_mb: 1016,
            pressure_in: 30,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 84,
            cloud: 0,
            feelslike_c: 1.5,
            feelslike_f: 34.7,
            windchill_c: 1.5,
            windchill_f: 34.7,
            heatindex_c: 3.6,
            heatindex_f: 38.5,
            dewpoint_c: -0.2,
            dewpoint_f: 31.7,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 8,
            gust_kph: 12.9,
            uv: 0.7,
          },
          {
            time_epoch: 1736697600,
            time: "2025-01-12 10:00",
            temp_c: 7,
            temp_f: 44.5,
            is_day: 1,
            condition: {
              text: "Sunny",
              icon: "//cdn.weatherapi.com/weather/64x64/day/113.png",
              code: 1000,
            },
            wind_mph: 4.7,
            wind_kph: 7.6,
            wind_degree: 280,
            wind_dir: "W",
            pressure_mb: 1016,
            pressure_in: 30,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 69,
            cloud: 0,
            feelslike_c: 5.2,
            feelslike_f: 41.4,
            windchill_c: 5.2,
            windchill_f: 41.4,
            heatindex_c: 7,
            heatindex_f: 44.5,
            dewpoint_c: -0.2,
            dewpoint_f: 31.6,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 7.5,
            gust_kph: 12.1,
            uv: 1.8,
          },
          {
            time_epoch: 1736701200,
            time: "2025-01-12 11:00",
            temp_c: 11.8,
            temp_f: 53.2,
            is_day: 1,
            condition: {
              text: "Sunny",
              icon: "//cdn.weatherapi.com/weather/64x64/day/113.png",
              code: 1000,
            },
            wind_mph: 6.3,
            wind_kph: 10.1,
            wind_degree: 303,
            wind_dir: "WNW",
            pressure_mb: 1017,
            pressure_in: 30.03,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 44,
            cloud: 0,
            feelslike_c: 7.5,
            feelslike_f: 45.6,
            windchill_c: 7.5,
            windchill_f: 45.6,
            heatindex_c: 9.1,
            heatindex_f: 48.4,
            dewpoint_c: 1.7,
            dewpoint_f: 35.1,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 16,
            vis_miles: 9,
            gust_mph: 7.7,
            gust_kph: 12.5,
            uv: 3,
          },
          {
            time_epoch: 1736704800,
            time: "2025-01-12 12:00",
            temp_c: 11.6,
            temp_f: 52.9,
            is_day: 1,
            condition: {
              text: "Partly Cloudy ",
              icon: "//cdn.weatherapi.com/weather/64x64/day/116.png",
              code: 1003,
            },
            wind_mph: 8.3,
            wind_kph: 13.3,
            wind_degree: 315,
            wind_dir: "NW",
            pressure_mb: 1015,
            pressure_in: 29.98,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 46,
            cloud: 26,
            feelslike_c: 10.3,
            feelslike_f: 50.5,
            windchill_c: 10.3,
            windchill_f: 50.5,
            heatindex_c: 11.6,
            heatindex_f: 52.9,
            dewpoint_c: 0,
            dewpoint_f: 32,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 9.5,
            gust_kph: 15.3,
            uv: 3.8,
          },
          {
            time_epoch: 1736708400,
            time: "2025-01-12 13:00",
            temp_c: 13.3,
            temp_f: 55.9,
            is_day: 1,
            condition: {
              text: "Sunny",
              icon: "//cdn.weatherapi.com/weather/64x64/day/113.png",
              code: 1000,
            },
            wind_mph: 8.9,
            wind_kph: 14.4,
            wind_degree: 322,
            wind_dir: "NW",
            pressure_mb: 1014,
            pressure_in: 29.96,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 41,
            cloud: 0,
            feelslike_c: 12,
            feelslike_f: 53.7,
            windchill_c: 12,
            windchill_f: 53.7,
            heatindex_c: 13.3,
            heatindex_f: 55.9,
            dewpoint_c: 1,
            dewpoint_f: 33.9,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 10.3,
            gust_kph: 16.6,
            uv: 3.8,
          },
          {
            time_epoch: 1736712000,
            time: "2025-01-12 14:00",
            temp_c: 14.2,
            temp_f: 57.5,
            is_day: 1,
            condition: {
              text: "Sunny",
              icon: "//cdn.weatherapi.com/weather/64x64/day/113.png",
              code: 1000,
            },
            wind_mph: 9.8,
            wind_kph: 15.8,
            wind_degree: 338,
            wind_dir: "NNW",
            pressure_mb: 1014,
            pressure_in: 29.96,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 37,
            cloud: 0,
            feelslike_c: 13.6,
            feelslike_f: 56.4,
            windchill_c: 13.6,
            windchill_f: 56.4,
            heatindex_c: 14.2,
            heatindex_f: 57.5,
            dewpoint_c: 0.5,
            dewpoint_f: 33,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 11.3,
            gust_kph: 18.2,
            uv: 3,
          },
          {
            time_epoch: 1736715600,
            time: "2025-01-12 15:00",
            temp_c: 14.7,
            temp_f: 58.4,
            is_day: 1,
            condition: {
              text: "Sunny",
              icon: "//cdn.weatherapi.com/weather/64x64/day/113.png",
              code: 1000,
            },
            wind_mph: 11.9,
            wind_kph: 19.1,
            wind_degree: 344,
            wind_dir: "NNW",
            pressure_mb: 1014,
            pressure_in: 29.95,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 37,
            cloud: 0,
            feelslike_c: 14.4,
            feelslike_f: 57.9,
            windchill_c: 14.4,
            windchill_f: 57.9,
            heatindex_c: 14.7,
            heatindex_f: 58.4,
            dewpoint_c: 0.4,
            dewpoint_f: 32.7,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 13.6,
            gust_kph: 22,
            uv: 1.8,
          },
          {
            time_epoch: 1736719200,
            time: "2025-01-12 16:00",
            temp_c: 14.4,
            temp_f: 58,
            is_day: 1,
            condition: {
              text: "Sunny",
              icon: "//cdn.weatherapi.com/weather/64x64/day/113.png",
              code: 1000,
            },
            wind_mph: 12.5,
            wind_kph: 20.2,
            wind_degree: 350,
            wind_dir: "N",
            pressure_mb: 1014,
            pressure_in: 29.96,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 38,
            cloud: 0,
            feelslike_c: 13.5,
            feelslike_f: 56.3,
            windchill_c: 13.5,
            windchill_f: 56.3,
            heatindex_c: 14.4,
            heatindex_f: 58,
            dewpoint_c: 0.9,
            dewpoint_f: 33.6,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 14.4,
            gust_kph: 23.2,
            uv: 0.8,
          },
          {
            time_epoch: 1736722800,
            time: "2025-01-12 17:00",
            temp_c: 14,
            temp_f: 57.2,
            is_day: 1,
            condition: {
              text: "Sunny",
              icon: "//cdn.weatherapi.com/weather/64x64/day/113.png",
              code: 1000,
            },
            wind_mph: 12.3,
            wind_kph: 19.8,
            wind_degree: 359,
            wind_dir: "N",
            pressure_mb: 1015,
            pressure_in: 29.96,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 40,
            cloud: 0,
            feelslike_c: 12.7,
            feelslike_f: 54.8,
            windchill_c: 12.7,
            windchill_f: 54.8,
            heatindex_c: 14,
            heatindex_f: 57.2,
            dewpoint_c: 0.8,
            dewpoint_f: 33.4,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 14.9,
            gust_kph: 24,
            uv: 0.2,
          },
          {
            time_epoch: 1736726400,
            time: "2025-01-12 18:00",
            temp_c: 13.2,
            temp_f: 55.7,
            is_day: 0,
            condition: {
              text: "Clear ",
              icon: "//cdn.weatherapi.com/weather/64x64/night/113.png",
              code: 1000,
            },
            wind_mph: 10.7,
            wind_kph: 17.3,
            wind_degree: 5,
            wind_dir: "N",
            pressure_mb: 1016,
            pressure_in: 29.99,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 44,
            cloud: 0,
            feelslike_c: 11.7,
            feelslike_f: 53,
            windchill_c: 11.7,
            windchill_f: 53,
            heatindex_c: 13.2,
            heatindex_f: 55.7,
            dewpoint_c: 1.5,
            dewpoint_f: 34.7,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 14.4,
            gust_kph: 23.2,
            uv: 0,
          },
          {
            time_epoch: 1736730000,
            time: "2025-01-12 19:00",
            temp_c: 11.4,
            temp_f: 52.6,
            is_day: 0,
            condition: {
              text: "Clear ",
              icon: "//cdn.weatherapi.com/weather/64x64/night/113.png",
              code: 1000,
            },
            wind_mph: 11.2,
            wind_kph: 18,
            wind_degree: 8,
            wind_dir: "N",
            pressure_mb: 1017,
            pressure_in: 30.03,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 51,
            cloud: 0,
            feelslike_c: 9.5,
            feelslike_f: 49.1,
            windchill_c: 9.5,
            windchill_f: 49.1,
            heatindex_c: 11.4,
            heatindex_f: 52.6,
            dewpoint_c: 2.6,
            dewpoint_f: 36.6,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 17.1,
            gust_kph: 27.5,
            uv: 0,
          },
          {
            time_epoch: 1736733600,
            time: "2025-01-12 20:00",
            temp_c: 10.1,
            temp_f: 50.2,
            is_day: 0,
            condition: {
              text: "Clear ",
              icon: "//cdn.weatherapi.com/weather/64x64/night/113.png",
              code: 1000,
            },
            wind_mph: 12.3,
            wind_kph: 19.8,
            wind_degree: 9,
            wind_dir: "N",
            pressure_mb: 1018,
            pressure_in: 30.07,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 56,
            cloud: 0,
            feelslike_c: 7.7,
            feelslike_f: 45.9,
            windchill_c: 7.7,
            windchill_f: 45.9,
            heatindex_c: 10.1,
            heatindex_f: 50.2,
            dewpoint_c: 1.4,
            dewpoint_f: 34.6,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 17.9,
            gust_kph: 28.8,
            uv: 0,
          },
          {
            time_epoch: 1736737200,
            time: "2025-01-12 21:00",
            temp_c: 9.1,
            temp_f: 48.4,
            is_day: 0,
            condition: {
              text: "Clear ",
              icon: "//cdn.weatherapi.com/weather/64x64/night/113.png",
              code: 1000,
            },
            wind_mph: 13.9,
            wind_kph: 22.3,
            wind_degree: 11,
            wind_dir: "NNE",
            pressure_mb: 1019,
            pressure_in: 30.1,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 61,
            cloud: 17,
            feelslike_c: 6.4,
            feelslike_f: 43.5,
            windchill_c: 6.4,
            windchill_f: 43.5,
            heatindex_c: 9.1,
            heatindex_f: 48.4,
            dewpoint_c: 1.7,
            dewpoint_f: 35.1,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 19.6,
            gust_kph: 31.6,
            uv: 0,
          },
          {
            time_epoch: 1736740800,
            time: "2025-01-12 22:00",
            temp_c: 8.3,
            temp_f: 46.9,
            is_day: 0,
            condition: {
              text: "Clear ",
              icon: "//cdn.weatherapi.com/weather/64x64/night/113.png",
              code: 1000,
            },
            wind_mph: 12.8,
            wind_kph: 20.5,
            wind_degree: 8,
            wind_dir: "N",
            pressure_mb: 1020,
            pressure_in: 30.14,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 67,
            cloud: 13,
            feelslike_c: 5.2,
            feelslike_f: 41.4,
            windchill_c: 5.2,
            windchill_f: 41.4,
            heatindex_c: 8.3,
            heatindex_f: 46.9,
            dewpoint_c: 2.3,
            dewpoint_f: 36.1,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 17.9,
            gust_kph: 28.7,
            uv: 0,
          },
          {
            time_epoch: 1736744400,
            time: "2025-01-12 23:00",
            temp_c: 7.5,
            temp_f: 45.5,
            is_day: 0,
            condition: {
              text: "Partly Cloudy ",
              icon: "//cdn.weatherapi.com/weather/64x64/night/116.png",
              code: 1003,
            },
            wind_mph: 12.5,
            wind_kph: 20.2,
            wind_degree: 7,
            wind_dir: "N",
            pressure_mb: 1021,
            pressure_in: 30.16,
            precip_mm: 0,
            precip_in: 0,
            snow_cm: 0,
            humidity: 72,
            cloud: 55,
            feelslike_c: 4.3,
            feelslike_f: 39.7,
            windchill_c: 4.3,
            windchill_f: 39.7,
            heatindex_c: 7.5,
            heatindex_f: 45.5,
            dewpoint_c: 2.7,
            dewpoint_f: 36.9,
            will_it_rain: 0,
            chance_of_rain: 0,
            will_it_snow: 0,
            chance_of_snow: 0,
            vis_km: 10,
            vis_miles: 6,
            gust_mph: 17.5,
            gust_kph: 28.2,
            uv: 0,
          },
        ],
      },
    ],
  },
};
