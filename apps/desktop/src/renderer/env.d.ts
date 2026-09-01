import type { RelayDesktopBridge } from "../preload";

declare global {
  interface Window {
    relayDesktop?: RelayDesktopBridge;
  }
}

export {};
