type SafeAreaInset = { top: number; bottom: number; left: number; right: number };

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        colorScheme?: "light" | "dark";
        /** Present from Bot API 8.0; absent on older clients. */
        safeAreaInset?: SafeAreaInset;
        /** Present from Bot API 8.0; absent on older clients. */
        contentSafeAreaInset?: SafeAreaInset;
        HapticFeedback?: {
          selectionChanged?: () => void;
          impactOccurred?: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
          notificationOccurred?: (type: "error" | "success" | "warning") => void;
        };
        ready?: () => void;
        expand?: () => void;
        /** Bot API 7.7+. */
        disableVerticalSwipes?: () => void;
        onEvent?: (event: string, handler: () => void) => void;
        offEvent?: (event: string, handler: () => void) => void;
      };
    };
    csrf_token?: string;
  }
}

export {};
