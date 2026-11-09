"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { clearOfflineData, OFFLINE_CACHE_ENABLED } from "@/lib/offline";

type Status = "idle" | "deleting" | "deleted" | "failed";

const STATUS_TEXT: Record<Exclude<Status, "idle" | "deleting">, string> = {
  deleted: "Offline copies deleted from this browser.",
  failed:
    "Couldn't delete them. Clear this site's data in your browser settings.",
};

/** Lets visitors remove every offline document copy from this browser. */
export function OfflineDataControl() {
  const [status, setStatus] = useState<Status>("idle");

  if (!OFFLINE_CACHE_ENABLED) {
    return <p>Offline copies are turned off on this deployment.</p>;
  }

  const onDelete = async () => {
    setStatus("deleting");
    try {
      await clearOfflineData();
      setStatus("deleted");
    } catch {
      setStatus("failed");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="sm"
        variant="outline"
        disabled={status === "deleting"}
        onClick={onDelete}
      >
        Delete offline copies
      </Button>
      <p role="status" aria-live="polite">
        {status === "deleted" || status === "failed" ? STATUS_TEXT[status] : ""}
      </p>
    </div>
  );
}
