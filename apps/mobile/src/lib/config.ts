import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { InstanceConfig } from "../model";

const BASE_URL_KEY = "relay.instance.baseUrl";
const TOKEN_KEY = "relay.instance.token";

function webStorageAvailable(): boolean {
  return Platform.OS === "web" && typeof globalThis.localStorage !== "undefined";
}

export async function loadInstanceConfig(): Promise<InstanceConfig> {
  if (webStorageAvailable()) {
    return {
      baseUrl: globalThis.localStorage.getItem(BASE_URL_KEY) ?? "",
      token: globalThis.localStorage.getItem(TOKEN_KEY) ?? "",
    };
  }
  const [baseUrl, token] = await Promise.all([
    SecureStore.getItemAsync(BASE_URL_KEY),
    SecureStore.getItemAsync(TOKEN_KEY),
  ]);
  return { baseUrl: baseUrl ?? "", token: token ?? "" };
}

export async function saveInstanceConfig(config: InstanceConfig): Promise<void> {
  if (webStorageAvailable()) {
    globalThis.localStorage.setItem(BASE_URL_KEY, config.baseUrl.trim());
    globalThis.localStorage.setItem(TOKEN_KEY, config.token.trim());
    return;
  }
  await Promise.all([
    SecureStore.setItemAsync(BASE_URL_KEY, config.baseUrl.trim()),
    SecureStore.setItemAsync(TOKEN_KEY, config.token.trim()),
  ]);
}
