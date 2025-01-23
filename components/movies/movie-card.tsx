import { Card } from "@/components/card";
import Skeleton from "@/components/ui/Skeleton";
import React from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { MovieTouchable } from "./movie-client-components";
// import { MOCK_DATA } from "./mock-movie-data";
import { CircularProgressBar } from "./circular-progress";

// export function TestMoviesCard() {
//   return <MoviesCard data={MOCK_DATA} person="Jack Black" />;
// }

// import * as AC from '@bacons/apple-colors';

export type MovieEntry = {
  adult: boolean;
  backdrop_path: string;
  id: number;
  title?: string;
  name?: string;
  original_language: string;
  original_title: string;
  overview: string;
  poster_path: string;
  media_type: string;
  genre_ids: number[];
  popularity: number;
  release_date: string;
  video: boolean;
  vote_average: number;
  vote_count: number;
  expo_placeholder?: string;
};

export type MoviesData = {
  page: number;
  results: MovieEntry[];
  total_pages: number;
  total_results: number;
};

export interface CreditsDune2 {
  id: number;
  cast: Cast[];
  crew: Cast[];
}

export interface Cast {
  adult: boolean;
  gender: number;
  id: number;
  known_for_department: Department;
  name: string;
  original_name: string;
  popularity: number;
  profile_path: null | string;
  cast_id?: number;
  character?: string;
  credit_id: string;
  order?: number;
  department?: Department;
  job?: string;
}

export enum Department {
  Acting = "Acting",
  Art = "Art",
  Camera = "Camera",
  CostumeMakeUp = "Costume & Make-Up",
  Crew = "Crew",
  Directing = "Directing",
  Editing = "Editing",
  Lighting = "Lighting",
  Production = "Production",
  Sound = "Sound",
  VisualEffects = "Visual Effects",
  Writing = "Writing",
}

export async function getMoviesData(): Promise<MoviesData["results"]> {
  const url = "https://api.themoviedb.org/3/trending/movie/day?language=en-US";

  const data = await fetch(url, {
    headers: {
      accept: "application/json",
      language: "en-US",
      Authorization: `Bearer ${process.env.TMDB_READ_ACCESS_TOKEN}`,
    },
  }).then((res) => res.json());

  console.log(JSON.stringify(data.results));
  return data.results;
}

export function MoviesCard({
  person,
  query,
  data,
  title,
}: {
  person?: string;
  query?: string;
  title?: string;
  data: Pick<
    MovieEntry,
    | "id"
    | "poster_path"
    | "media_type"
    | "title"
    | "name"
    | "overview"
    | "vote_average"
    | "expo_placeholder"
  >[];
}) {
  const displayMovies = data
    .filter((item) => {
      return item.poster_path && (item.title || item.name);
    })
    .slice(
      0,
      Math.min(process.env.EXPO_OS === "android" ? 6 : 25, data.length)
    );

  return (
    <>
      <Card
        title={
          title
            ? title
            : person
            ? `Movies with ${person}`
            : query
            ? `Searched '${query}'`
            : `Trending movies`
        }
        style={{
          padding: 0,
        }}
      >
        {/* Horizontal scrolling list with movies */}
        <ScrollView horizontal contentContainerStyle={{ padding: 8, gap: 8 }}>
          {displayMovies.map((movie) => (
            <MovieCard key={movie.id} movie={movie} />
          ))}
        </ScrollView>
      </Card>
    </>
  );
}

const POSTER_WIDTH = 150;
const POSTER_RATIO = 1.5;

function MovieCard({
  movie,
}: {
  movie: Pick<
    MovieEntry,
    | "poster_path"
    | "title"
    | "name"
    | "media_type"
    | "overview"
    | "vote_average"
    | "expo_placeholder"
    | "id"
  >;
}) {
  const showRating = movie.vote_average > 0;
  return (
    <MovieTouchable
      style={{ width: POSTER_WIDTH, gap: 4 }}
      movie={{
        ...movie,
        poster_path: `https://image.tmdb.org/t/p/w500${movie.poster_path}`,
      }}
    >
      <View style={{ width: POSTER_WIDTH, paddingBottom: showRating ? 12 : 0 }}>
        <Image
          source={{
            uri: `https://image.tmdb.org/t/p/w500${movie.poster_path}`,
          }}
          style={{
            resizeMode: "cover",
            width: POSTER_WIDTH,
            height: POSTER_WIDTH * POSTER_RATIO,
            backgroundColor: "rgb(205, 205, 205)",
            overflow: "hidden",
            borderRadius: 8,
          }}
        />

        {showRating && (
          <View
            style={{
              position: "absolute",
              bottom: 0,
              left: 8,
              transform: [{ translateY: 4 }],
            }}
          >
            <CircularProgressBar
              percentage={movie.vote_average * 10}
              size={48}
              strokeWidth={3}
            />
          </View>
        )}
      </View>
      <Text
        style={{
          color: "black",
          fontSize: 16,
          fontWeight: "bold",
          marginTop: 4,
        }}
        numberOfLines={2}
        lineBreakMode="tail"
      >
        {movie.title ?? movie.name}
      </Text>
      <Text
        style={{ color: Colors.gray, fontSize: 12 }}
        numberOfLines={3}
        lineBreakMode="tail"
      >
        {movie.overview}
      </Text>
    </MovieTouchable>
  );
}

function MovieSkeleton() {
  return (
    <View
      style={{
        width: POSTER_WIDTH,

        flexDirection: "column",

        minHeight: 315,
      }}
    >
      <Skeleton
        style={{
          width: POSTER_WIDTH,
          height: POSTER_WIDTH * POSTER_RATIO,
          borderRadius: 8,
        }}
        dark={false}
      />
      <Skeleton
        dark={false}
        style={{ width: "80%", height: 16, marginTop: 8 }}
      />
      <Skeleton
        dark={false}
        style={{ width: "95%", height: 10, marginTop: 4, flex: 1 }}
      />
    </View>
  );
}

export function MoviesSkeleton() {
  return (
    <Card
      title="Fetching..."
      style={{
        padding: 0,

        pointerEvents: "none",
      }}
    >
      {/* Horizontal scrolling list with movies */}
      <View style={{ gap: 8, padding: 8, flexDirection: "row" }}>
        {[0, 1, 2, 3].map((movie) => (
          <MovieSkeleton key={movie} />
        ))}
      </View>
    </Card>
  );
}

const Colors = {
  gray: "#686F81",
};
