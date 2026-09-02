import { StatusBar } from "expo-status-bar";
import { StyleSheet, View } from "react-native";
import { useCallback, useState } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { useRelay } from "./src/hooks/useRelay";
import { ChatsScreen } from "./src/screens/ChatsScreen";
import { ConnectionScreen } from "./src/screens/ConnectionScreen";
import { usePushNotifications } from "./src/lib/pushNotifications";

function AppContent() {
  const relay = useRelay();
  const [requestedConversationId, setRequestedConversationId] = useState<string | null>(null);
  const openNotificationConversation = useCallback((conversationId: string) => setRequestedConversationId(conversationId), []);
  const selectConversation = useCallback((conversationId: string | null) => {
    relay.dispatch({ type: "selectConversation", conversationId });
  }, [relay.dispatch]);
  const clearRequestedConversation = useCallback(() => setRequestedConversationId(null), []);
  usePushNotifications({
    connected: relay.state.connection === "live",
    registerToken: relay.registerPushSubscription,
    openConversation: openNotificationConversation,
  });

  if (relay.state.connection !== "live") {
    return (
      <View style={styles.app}>
        <StatusBar style="light" />
        <ConnectionScreen connecting={relay.state.connection === "loading" && Boolean(relay.config.baseUrl)} onConnect={relay.connect} />
      </View>
    );
  }

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      <ChatsScreen
        config={relay.config}
        connected={relay.state.connection === "live"}
        state={relay.state}
        onSelectConversation={selectConversation}
        onSend={relay.sendMessage}
        onClear={relay.clearConversation}
        requestedConversationId={requestedConversationId}
        onRequestedConversationHandled={clearRequestedConversation}
      />
    </View>
  );
}

export default function App() {
  return (
    <KeyboardProvider>
      <AppContent />
    </KeyboardProvider>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: "#000000",
  },
});
