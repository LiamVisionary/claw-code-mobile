import * as Form from "@/components/ui/Form";
import * as AC from "@bacons/apple-colors";
import { View } from "react-native";

const toolCalls = {
  get_media: {
    description: "List movies or TV shows today or this week from TMDB",
  },
  get_weather: {
    description: "Get the current weather for a city",
  },
  get_points_of_interest: {
    description: "Get things to do for a point of interest or city",
  },
};

export function ToolCallsFyi() {
  return (
    <Form.List contentContainerStyle={{ paddingTop: 0 }}>
      <Form.Section
        title="What can I ask the AI?"
        footer="These are the tool calls with special handling. Ask related questions to see them in action."
      >
        {Object.entries(toolCalls).map(([key, value]) => (
          <View style={{ gap: 6 }} key={key}>
            <Form.Text>{key}</Form.Text>
            <Form.Text style={{ color: AC.secondaryLabel }}>
              {value.description}
            </Form.Text>
          </View>
        ))}
      </Form.Section>
    </Form.List>
  );
}
