import { Text, Image, View } from "react-native";


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
            padding: 16,
            borderRadius: 16,
            backgroundColor: "white",
            shadowColor: "#000",
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
            <Text
            style={{
                fontSize: 24,
                fontWeight: "bold",
                color: Colors.navy,
                marginBottom: 16,
            }}
            >
            {title}
            </Text>
            {children}
        </View>
        );
}

// export function WeatherSkeleton() {
//   return (
//     <SubtleScaleAndFadeIn style={{ flex: 1 }}>
//       <Card title="Fetching...">
//         {/* Upper */}
//         <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
//           <View style={{ gap: 8 }}>
//             <Skeleton style={{ width: 60, height: 40, borderRadius: 666 }} />
//             {/* Current temp in F */}
//             <View
//               style={{
//                 flexDirection: "row",
//                 gap: 8,
//                 alignItems: "center",
//               }}
//             >
//               <Skeleton
//                 style={{
//                   width: 24,
//                   minHeight: 24,
//                   height: 24,
//                   borderRadius: 666,
//                 }}
//               />
//               <Skeleton
//                 style={{
//                   width: 96,
//                   minHeight: 24,
//                   height: 24,
//                   borderRadius: 8,
//                 }}
//               />
//             </View>
//           </View>

//           <Skeleton style={{ width: 80, height: 80, borderRadius: 666 }} />
//         </View>

//         {/* Lower */}
//         <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
//           <View style={{ gap: 6 }}>
//             {/* 30° / 21° Feels like 43° */}
//             <Skeleton
//               style={{ width: 180, minHeight: 24, height: 24, borderRadius: 8 }}
//             />

//             {/* Wed, 2:39 pm */}
//             <Skeleton
//               style={{
//                 width: 96,
//                 minHeight: 24,
//                 height: 24,
//                 borderRadius: 666,
//               }}
//             />
//           </View>

//           {/*  */}
//           <View style={{ gap: 2, alignItems: "flex-start" }}>
//             {/* Sunrise time */}
//             <View
//               style={{
//                 flexDirection: "row",
//                 gap: 8,
//                 alignItems: "center",
//                 justifyContent: "space-between",
//                 flex: 1,
//               }}
//             >
//               <Skeleton
//                 style={{
//                   width: 24,
//                   maxHeight: 24,
//                   minHeight: 24,
//                   borderRadius: 12,
//                 }}
//               />
//               <Skeleton
//                 style={{
//                   width: 56,
//                   maxHeight: 24,
//                   minHeight: 24,
//                   borderRadius: 8,
//                 }}
//               />
//             </View>
//             {/* Sunset time */}
//             <View
//               style={{
//                 flexDirection: "row",
//                 gap: 8,
//                 alignItems: "center",
//                 justifyContent: "space-between",
//                 flex: 1,
//               }}
//             >
//               <Skeleton
//                 style={{
//                   width: 24,
//                   maxHeight: 24,
//                   minHeight: 24,
//                   borderRadius: 12,
//                 }}
//               />
//               <Skeleton
//                 style={{
//                   width: 56,
//                   maxHeight: 24,
//                   minHeight: 24,
//                   borderRadius: 8,
//                 }}
//               />
//             </View>
//           </View>
//         </View>
//         {/*  */}
//         <Skeleton
//           style={{ width: 56, maxHeight: 36, minHeight: 36, borderRadius: 666 }}
//         />
//       </Card>
//     </SubtleScaleAndFadeIn>
//   );
// }

export function WeatherCard({
  city,
  data,
}: {
  city: string;
  data: LocationData;
}) {
  return (
    <Card title={`Results for ${city}`} style={{ backgroundColor: "white" }}>
      {/* Upper */}
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <View>
          {/* Current temp in F */}
          <Text
            style={{ fontSize: 36, color: Colors.navy, fontWeight: "bold" }}
          >
            {data.current.temp_f}
          </Text>
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              alignItems: "center",
            }}
          >
            <Image
              style={{ width: 16, height: 16, aspectRatio: 1 }}
              resizeMode="contain"
              source={require("./assets/location.png")}
            />
            {/* City */}
            <Text
              style={{ color: Colors.navy, fontSize: 18, fontWeight: "500" }}
            >
              {data.location.name}
            </Text>
          </View>
        </View>

        <Image
          style={{
            width: 80,
            height: 80,
            resizeMode: "contain",
            aspectRatio: 1,
            shadowColor: Colors.navy,
            shadowOffset: {
              width: 0,
              height: 3,
            },
            shadowOpacity: 0.29,
            shadowRadius: 4.65,

            elevation: 7,
          }}
          source={{ uri: `https:${data.current.condition.icon}` }}
        />
      </View>

      {/* Lower */}
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <View style={{ gap: 6 }}>
          {/* 30° / 21° Feels like 43° */}
          <Text style={{ color: Colors.navy, fontSize: 16, fontWeight: "600" }}>
            <Text
              celcius={data.forecast.forecastday[0].day.maxtemp_c}
            >
              {data.forecast.forecastday[0].day.maxtemp_f}
            </Text>{" "}
            /{" "}
            <Text
              celcius={data.forecast.forecastday[0].day.mintemp_c}
            >
              {data.forecast.forecastday[0].day.mintemp_f}
            </Text>{" "}
            Feels like{" "}
            <Text celcius={data.current.feelslike_c}>
              {data.current.feelslike_f}
            </Text>
          </Text>
          {/* Wed, 2:39 pm */}
          <Text style={{ color: Colors.gray, fontWeight: "500", fontSize: 16 }}>
            {new Date(data.current.last_updated).toLocaleString("en-US", {
              weekday: "short",
              hour: "numeric",
              minute: "numeric",
            })}
          </Text>
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
            <Image
              style={{ width: 24, height: 24, tintColor: Colors.navy }}
              source={require("./assets/weather/sunrise.png")}
            />
            <Text
              style={{ color: Colors.navy, fontWeight: "500", fontSize: 16 }}
            >
              {data.forecast.forecastday[0].astro.sunrise}
            </Text>
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
            <Image
              style={{ width: 24, height: 24, tintColor: Colors.navy }}
              source={require("./assets/weather/sunset.png")}
            />
            <Text
              style={{ color: Colors.navy, fontWeight: "500", fontSize: 16 }}
            >
              {data.forecast.forecastday[0].astro.sunset}
            </Text>
          </View>
        </View>
      </View>
      {/*  */}
      {/* <SwitchDegreesSwitch /> */}
    </Card>
  );
}

const Colors = {
  navy: "#102151",
  gray: "#686F81",
};
