/// <reference types="react/canary" />

import { renderRoot } from "@/actions/render-root";
import { ChatToolbarInner } from "@/components/chat-toolbar";
// import { ChatUI } from "@/components/chatui";
import React from "react";
import { ActivityIndicator, View } from "react-native";

export { ErrorBoundary } from "expo-router";

export default function Index() {
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
