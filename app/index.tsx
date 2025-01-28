/// <reference types="react/canary" />

import { renderRoot } from "@/actions/render-root";
import { ChatContainer } from "@/components/chat-container";
import { ChatToolbarInner } from "@/components/chat-toolbar";
import React from "react";
import { ActivityIndicator } from "react-native";

export { ErrorBoundary } from "expo-router";

export default function Index() {
  return <React.Suspense fallback={<Loading />}>{renderRoot()}</React.Suspense>;
}

function Loading() {
  return (
    <ChatContainer style={{ justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator size="large" />
      <ChatToolbarInner
        disabled
        messages={[]}
        setMessages={() => {}}
        onSubmit={async () => ({
          id: Math.random().toString(36).slice(2),
          display: <></>,
        })}
      />
    </ChatContainer>
  );
}
