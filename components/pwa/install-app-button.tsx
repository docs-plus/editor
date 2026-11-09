"use client";

import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trackEvent } from "@/lib/analytics";
import { InstallAppIcon, ShareIcon } from "@/lib/icons";
import {
  getInstallAvailability,
  type InstallAvailability,
  promptInstall,
  subscribeInstall,
} from "@/lib/pwa/install-prompt";

const LABEL = "Install TinyDocy";
const ICON_CLASS = "size-3.5";

const getServerAvailability = (): InstallAvailability => "none";

async function handleInstall(): Promise<void> {
  const outcome = await promptInstall();
  if (outcome) trackEvent("pwa_install", { outcome });
}

/**
 * Status-strip install affordance. Chromium: opens the native dialog from
 * the captured `beforeinstallprompt`. iOS: a one-line Add to Home Screen
 * hint. Renders nothing when installed or not installable.
 */
export function InstallAppButton() {
  const availability = useSyncExternalStore(
    subscribeInstall,
    getInstallAvailability,
    getServerAvailability,
  );

  if (availability === "none") return null;

  const trigger = (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground"
      aria-label={LABEL}
    >
      <InstallAppIcon className={ICON_CLASS} />
    </Button>
  );

  if (availability === "prompt") {
    return (
      <Tooltip>
        <TooltipTrigger render={trigger} onClick={() => void handleInstall()} />
        <TooltipContent side="top" sideOffset={6}>
          Install TinyDocy as an app
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover>
      <PopoverTrigger render={trigger} />
      <PopoverContent side="top" align="end" className="w-60 text-xs">
        <p>
          Tap{" "}
          <ShareIcon
            className="inline size-3.5 align-text-bottom"
            role="img"
            aria-label="Share"
          />
          , then <strong>Add to Home Screen</strong>.
        </p>
      </PopoverContent>
    </Popover>
  );
}
