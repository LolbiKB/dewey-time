import { useEffect, useState } from "react";
import { BellIcon, BellOffIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { disablePush, enablePush, isPushEnabled, isPushSupported, sendTestPush } from "@/pwa/push";

/**
 * Header bell: opt in/out of push notifications on this device + send a test.
 * Renders nothing where push isn't supported (e.g. iOS Safari outside the
 * installed app). The actual delivery stays inert until an admin enables web
 * push in Dewey Time Settings and configures VAPID.
 */
export function NotificationsButton() {
  const [supported] = useState(isPushSupported);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) return;
    isPushEnabled()
      .then(setEnabled)
      .catch(() => {});
  }, [supported]);

  if (!supported) return null;

  const onToggle = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        await enablePush();
        setEnabled(true);
        toast.success("Push notifications enabled on this device");
      } else {
        await disablePush();
        setEnabled(false);
        toast("Push notifications turned off");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't change notifications");
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    try {
      await sendTestPush();
      toast.success("Test notification sent");
    } catch {
      toast.error("Couldn't send a test notification");
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notification settings" className="size-8">
          {enabled ? (
            <BellIcon className="size-4" />
          ) : (
            <BellOffIcon className="size-4 opacity-70" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="push-toggle" className="text-sm font-medium">
            Push notifications
          </Label>
          <Switch id="push-toggle" checked={enabled} disabled={busy} onCheckedChange={onToggle} />
        </div>
        <p className="text-xs text-muted-foreground">
          Get notified on this device. You can turn this off anytime.
        </p>
        {enabled && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onTest}>
            Send test notification
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
