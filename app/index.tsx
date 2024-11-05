/// <reference types="react/canary" />

import { callServer } from "@/components/actions";
import { Suspense } from "react";
import { Text } from "react-native";

export default function Index() {
  // const { messages, handleSubmit, input, setInput, append } = useChat();

  return <Suspense fallback={<Text>Loading...</Text>}>{callServer()}</Suspense>;
}
