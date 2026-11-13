"use client";

import {
  Component,
  type ComponentType,
  lazy,
  type ReactNode,
  Suspense,
} from "react";

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
  /** Shown while the chunk loads. */
  fallback?: ReactNode;
  /** Called once the failure is caught, e.g. to let the next mount retry. */
  onError: () => void;
  children?: ReactNode;
}

/**
 * Suspense for a lazy surface that renders nothing instead of throwing when
 * the chunk does not load (or the surface throws), so the editor and the
 * rest of the page stay mounted.
 */
export class SurfaceBoundary extends Component<
  SurfaceBoundaryProps,
  { error?: true }
> {
  state = {};

  static getDerivedStateFromError = () => ({ error: true });

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    const { fallback, children } = this.props;
    return "error" in this.state ? null : (
      <Suspense fallback={fallback}>{children}</Suspense>
    );
  }
}

/**
 * A surface chunk that can fail to load (offline, or a deploy replaced it),
 * rendered inside its own `SurfaceBoundary`. React keeps a rejected
 * `lazy()` for good, so the boundary's `onError` swaps in a fresh one and
 * the next mount fetches the chunk again. Swapping any earlier (in the
 * rejection) would make React's retry render start a new fetch at once, in
 * a loop.
 */
export function lazySurface<P extends object>(
  load: () => Promise<ComponentType<P>>,
  fallback?: ReactNode,
) {
  const make = () => lazy(() => load().then((loaded) => ({ default: loaded })));
  let Lazy = make();
  const retry = () => {
    Lazy = make();
  };
  // biome-ignore lint/correctness/noComponentHookFactories: called once per surface at module level, like `lazy()` itself
  return function LazySurface(props: P) {
    return (
      <SurfaceBoundary fallback={fallback} onError={retry}>
        <Lazy {...props} />
      </SurfaceBoundary>
    );
  };
}
