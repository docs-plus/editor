"use client";

import {
  Component,
  type ComponentType,
  lazy,
  type ReactNode,
  Suspense,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { CircleAlertIcon } from "@/lib/icons";

/**
 * Surface chunks that are not on screen at first paint (owner decision
 * O1): the colour popover body and the Insert steps.
 */
export const loadColorPanel = () => import("./color/color-panel");
export const loadInsertStep = () => import("./insert/insert-step");

/**
 * Fetches both chunks: on hover or focus of their triggers, and when the
 * browser is idle after the first server sync, so the service worker has
 * them before the user goes offline. A failed fetch is retried on open.
 */
export const preloadSurfaces = () => {
  for (const load of [loadColorPanel, loadInsertStep]) {
    load().catch(() => undefined);
  }
};

interface SurfaceBoundaryProps {
  /** Shown while the chunk loads, and in place of a nameless failure. */
  fallback?: ReactNode;
  /** Called once the failure is caught, e.g. to let the next mount retry. */
  onError: () => void;
  /**
   * Names the surface in the failure hint ("colours" → "Couldn’t load
   * colours."). Without one a failure shows `fallback`, or nothing: the
   * bubble just stays away.
   */
  name?: string;
  /** Retry: re-render the owner, so it renders a fresh `lazy()`. */
  onRetry?: () => void;
  children?: ReactNode;
}

/**
 * Suspense for a lazy surface that never throws when the chunk does not
 * load (or the surface throws), so the editor and the rest of the page stay
 * mounted. A named surface says so in its place, with Retry (design pass
 * §12): muted, never red, because nothing the writer did is wrong.
 */
export class SurfaceBoundary extends Component<
  SurfaceBoundaryProps,
  { error: boolean }
> {
  state = { error: false };

  static getDerivedStateFromError = () => ({ error: true });

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    const { fallback, children, name, onRetry } = this.props;
    if (!this.state.error) {
      return <Suspense fallback={fallback}>{children}</Suspense>;
    }
    // No padding of its own: the popover around it has it (design pass §12).
    return name ? (
      <p className="flex items-center gap-2 text-sm" role="status">
        <CircleAlertIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        Couldn’t load {name}.
        <Button
          size="sm"
          variant="outline"
          className="ms-auto"
          onClick={() => {
            this.setState({ error: false });
            onRetry?.();
          }}
        >
          Retry
        </Button>
      </p>
    ) : (
      fallback
    );
  }
}

/**
 * A surface chunk that can fail to load (offline, or a deploy replaced it),
 * rendered inside its own `SurfaceBoundary`. React keeps a rejected
 * `lazy()` for good, so the boundary's `onError` swaps in a fresh one and
 * Retry, or the next mount, fetches the chunk again. Swapping any earlier
 * (in the rejection) would make React's retry render start a new fetch at
 * once, in a loop. Retry re-renders this wrapper as well as the boundary:
 * the boundary's children were made from the rejected `lazy()`.
 */
export function lazySurface<P extends object>(
  load: () => Promise<ComponentType<P>>,
  fallback?: ReactNode,
  name?: string | ((props: P) => string),
) {
  const make = () => lazy(() => load().then((loaded) => ({ default: loaded })));
  let Lazy = make();
  const swap = () => {
    Lazy = make();
  };
  // biome-ignore lint/correctness/noComponentHookFactories: called once per surface at module level, like `lazy()` itself
  return function LazySurface(props: P) {
    const [, setAttempt] = useState(0);
    return (
      <SurfaceBoundary
        fallback={fallback}
        onError={swap}
        name={typeof name === "function" ? name(props) : name}
        onRetry={() => setAttempt((n) => n + 1)}
      >
        <Lazy {...props} />
      </SurfaceBoundary>
    );
  };
}
