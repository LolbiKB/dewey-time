type SafeAreaInset = { top: number; bottom: number; left: number; right: number };

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        /** Client-supplied and explicitly untrusted. Decoration only — the
         *  server's answer is what identifies anyone. */
        initDataUnsafe?: { user?: { photo_url?: string; language_code?: string } };
        colorScheme?: "light" | "dark";
        /** Partial by contract: every field is optional in the Bot API, and
         *  older clients send only the first handful. */
        themeParams?: Record<string, string | undefined>;
        /** Bot API 6.1+ / 7.10+ for the bottom bar. */
        setHeaderColor?: (color: string) => void;
        setBackgroundColor?: (color: string) => void;
        setBottomBarColor?: (color: string) => void;
        BackButton?: {
          show?: () => void;
          hide?: () => void;
          onClick?: (handler: () => void) => void;
          offClick?: (handler: () => void) => void;
        };
        isVersionAtLeast?: (version: string) => boolean;
        /** Bot API 8.0+. False while the Mini App is minimised behind the chat. */
        isActive?: boolean;
        /** Bot API 6.9+. Per-user, follows them across devices. */
        CloudStorage?: {
          getItem?: (key: string, cb: (err: unknown, value?: string) => void) => void;
          setItem?: (key: string, value: string, cb?: (err: unknown) => void) => void;
        };
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
