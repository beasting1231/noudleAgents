import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

let activeConversationId: string | null = null;
let appIsActive = AppState.currentState === "active";

function conversationIdFromResponse(response: Notifications.NotificationResponse): string | null {
  const value = response.notification.request.content.data?.conversationId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const value = notification.request.content.data?.conversationId;
    const isVisibleChat = appIsActive && typeof value === "string" && value === activeConversationId;
    return {
      shouldShowBanner: !isVisibleChat,
      shouldShowList: !isVisibleChat,
      shouldPlaySound: !isVisibleChat,
      shouldSetBadge: false,
    };
  },
});

export function setVisibleConversation(conversationId: string | null): void {
  activeConversationId = conversationId;
}

export function usePushNotifications({
  connected,
  registerToken,
  openConversation,
}: {
  connected: boolean;
  registerToken: (token: string) => Promise<void>;
  openConversation: (conversationId: string) => void;
}): void {
  const handledResponseId = useRef<string | null>(null);

  useEffect(() => {
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      appIsActive = state === "active";
    });
    const notificationSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      handledResponseId.current = response.notification.request.identifier;
      const conversationId = conversationIdFromResponse(response);
      if (conversationId) openConversation(conversationId);
    });
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response || response.notification.request.identifier === handledResponseId.current) return;
      handledResponseId.current = response.notification.request.identifier;
      const conversationId = conversationIdFromResponse(response);
      if (conversationId) openConversation(conversationId);
    });
    return () => {
      appStateSubscription.remove();
      notificationSubscription.remove();
    };
  }, [openConversation]);

  useEffect(() => {
    if (!connected || Platform.OS === "web") return;
    let cancelled = false;
    void (async () => {
      const current = await Notifications.getPermissionsAsync();
      const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
      if (!permission.granted || cancelled) return;
      const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
      if (typeof projectId !== "string" || projectId.length === 0) return;
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      if (!cancelled) await registerToken(token.data);
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [connected, registerToken]);
}
