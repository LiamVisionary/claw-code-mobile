/// <reference types="react/canary" />

import { renderRoot } from "@/actions/render-root";
import { ChatToolbarInner } from "@/components/chat-toolbar";
import { MOCK_TRENDING_SHOWS_THIS_WEEK } from "@/components/movies/mock-movie-data";
import { MoviesCard } from "@/components/movies/movie-card";
import { router } from "expo-router";
// import { ChatUI } from "@/components/chatui";
import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";

export { ErrorBoundary } from "expo-router";

export default function Index() {
  // useEffect(() => {

  //   setTimeout(() => {
  //     router.push("/movie/123")
  //   }, 1)
  // }, []);

  return <React.Suspense fallback={<Loading />}>{renderRoot()}</React.Suspense>;
}

function Loading() {
  return (
    <View style={{ flex: 1, justifyContent: "center" }}>
      <ActivityIndicator size={"large"} />
      <ChatToolbarInner
        disabled
        messages={[]}
        setMessages={() => {}}
        onSubmit={() => {}}
      />
    </View>
  );
}
