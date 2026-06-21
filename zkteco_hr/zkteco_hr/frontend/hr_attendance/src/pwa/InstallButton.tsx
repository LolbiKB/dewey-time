import { useEffect, useState } from "react";
import { DownloadIcon, PlusSquareIcon, ShareIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** Already running as an installed app (standalone display or iOS home-screen). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS 13+ masquerades as Mac — fall back to a touch check.
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Header "Install" affordance. Chromium fires `beforeinstallprompt` (captured and
 * replayed on click); iOS has no such event, so we show an Add-to-Home-Screen
 * instructions modal instead. Renders nothing when already installed or when the
 * platform offers no install path.
 */
export function InstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [iosOpen, setIosOpen] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;
  const ios = isIos();
  if (!deferred && !ios) return null; // nothing to offer on this platform yet

  const onClick = async () => {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
      return;
    }
    setIosOpen(true);
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={onClick} className="gap-1.5">
        <DownloadIcon className="size-4 shrink-0 opacity-80" />
        <span className="hidden sm:inline">Install</span>
      </Button>

      {ios && (
        <Dialog open={iosOpen} onOpenChange={setIosOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Install Dewey Time</DialogTitle>
              <DialogDescription>
                Add the app to your Home Screen for a full-screen, app-like experience.
              </DialogDescription>
            </DialogHeader>
            <ol className="space-y-3 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <ShareIcon className="size-4 shrink-0 text-foreground" />
                <span>Tap the Share button in Safari's toolbar.</span>
              </li>
              <li className="flex items-center gap-2">
                <PlusSquareIcon className="size-4 shrink-0 text-foreground" />
                <span>Choose "Add to Home Screen".</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="grid size-4 shrink-0 place-items-center text-foreground">→</span>
                <span>Tap "Add" to confirm.</span>
              </li>
            </ol>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
