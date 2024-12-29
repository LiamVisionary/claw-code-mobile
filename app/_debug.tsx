import { Stack } from "expo-router";
import { Text, View } from "react-native";
import Constants from "expo-constants";
import {
  getRequestHeaders,
  pingServer,
  pingServerError,
} from "@/components/debug/debug-actions";
import { useState } from "react";
import { BodyScrollView } from "@/components/ui/BodyScrollView";
import * as Form from "@/components/ui/Form";
import * as AC from "@bacons/apple-colors";

export { ErrorBoundary } from "expo-router";

export default function DebugRoute() {
  const [error, setError] = useState<Error | null>(null);
  const [headers, setHeaders] = useState<Record<
    string,
    string | string[]
  > | null>(null);
  return (
    <>
      <BodyScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 24,
          paddingBottom: 64,
        }}
        contentInset={{
          bottom: 24,
        }}
      >
        <Form.Section
          title="window.location"
          footer="Embedded origin URL that Expo Router uses to invoke server actions. This should be hosted and available to the client."
        >
          <Form.Text
            onPress={() => Clipboard.setStringAsync(window.location?.href)}
            hint={window.location?.href}
          >
            href
          </Form.Text>
        </Form.Section>

        <Form.Section
          title="Server"
          footer="Call a React server action from your app to test the connection."
        >
          <Form.Text
            systemImage={"bolt.fill"}
            onPress={async () => {
              try {
                const response = await pingServer();
                alert(response);
              } catch (error) {
                setError(error);
                alert(`Error: ${error}`);
              }
            }}
          >
            Ping Server
          </Form.Text>
          <Form.Text
            style={{ color: AC.systemRed }}
            systemImage={{ name: "bolt.fill", color: AC.systemRed }}
            onPress={async () => {
              try {
                await pingServerError();
              } catch (error) {
                setError(error);
                alert(`Error: ${error}`);
              }
            }}
          >
            Ping Server with Error
          </Form.Text>
        </Form.Section>

        {error && <NetworkErrorView error={error} />}

        <Form.Section title="Request Headers">
          <Form.Text
            systemImage={{ name: "bolt.fill" }}
            onPress={async () => {
              try {
                setHeaders(await getRequestHeaders());
              } catch (error: any) {
                setError(error);
                alert(`Error: ${error}`);
              }
            }}
          >
            Fetch headers
          </Form.Text>
          <View>
            <Form.Text>{JSON.stringify(headers, null, 2)}</Form.Text>
          </View>
        </Form.Section>

        <Form.Section title="Manifest">
          <View>
            <Form.Text>
              {JSON.stringify(Constants.expoConfig, null, 2)}
            </Form.Text>
          </View>
        </Form.Section>
      </BodyScrollView>

      <Stack.Screen options={{ title: "Debug" }} />
    </>
  );
}

import * as Clipboard from "expo-clipboard";

function NetworkErrorView({ error }: { error: Error }) {
  if (error instanceof Error) {
    const headers =
      "headers" in error && error.headers instanceof Headers
        ? Object.fromEntries(error.headers.entries())
        : null;

    return (
      <>
        <Form.Section
          title="Server Error"
          footer={"Error thrown by the server while making the test request."}
        >
          <Form.Text numberOfLines={10} hint={error.message}>
            Message
          </Form.Text>
          {"statusCode" in error && (
            <Form.Text hint={String(error.statusCode)}>Status</Form.Text>
          )}
          <Text numberOfLines={50}>Stack: {error.stack}</Text>
          <Text>{Object.keys(error).join(", ")}</Text>
        </Form.Section>
        {headers && (
          <Form.Section title="Error response headers">
            {Object.entries(headers).map(([key, value]) => (
              <Form.Text
                numberOfLines={10}
                onPress={() => {
                  Clipboard.setStringAsync(`${key}=${value}`);
                }}
                key={key}
                hint={value}
              >
                {key}
              </Form.Text>
            ))}
          </Form.Section>
        )}
      </>
    );
  }
  return <Text>{error}</Text>;
}
