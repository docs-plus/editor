"use client";

import { Button } from "@/components/ui/button";

/**
 * Route error boundary: a malformed shared document or tab list shows a
 * recoverable message instead of a blank page.
 */
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        The editor hit an unexpected error. Try again, or reload the page.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => reset()}>
          Try again
        </Button>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    </main>
  );
}
