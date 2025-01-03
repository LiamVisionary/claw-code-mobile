/// <reference types="react/canary" />

import { renderRoot } from "@/actions/render-root";
// import { ChatUI } from "@/components/chatui";
import React from "react";
import { ActivityIndicator } from "react-native";

export { ErrorBoundary } from "expo-router";

export default function Index() {
  return (
    <React.Suspense fallback={<ActivityIndicator />}>
      {renderRoot()}
    </React.Suspense>
  );
}
