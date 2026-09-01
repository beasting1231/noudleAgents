import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "relay.message-draft.";

export async function loadMessageDraft(conversationId: string): Promise<string> {
  return (await AsyncStorage.getItem(`${PREFIX}${conversationId}`)) ?? "";
}

export async function saveMessageDraft(conversationId: string, value: string): Promise<void> {
  const key = `${PREFIX}${conversationId}`;
  if (value) await AsyncStorage.setItem(key, value);
  else await AsyncStorage.removeItem(key);
}
