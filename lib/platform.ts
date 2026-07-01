import { Capacitor } from "@capacitor/core";

export const platform  = Capacitor.getPlatform() as "android" | "ios" | "web";
export const isAndroid = platform === "android";
export const isIOS     = platform === "ios";
export const isNative  = Capacitor.isNativePlatform();
export const isWeb     = platform === "web";
