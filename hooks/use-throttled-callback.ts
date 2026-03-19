import throttle from "lodash.throttle";
import { useEffect, useMemo } from "react";

interface ThrottleSettings {
  leading?: boolean | undefined;
  trailing?: boolean | undefined;
}

const defaultOptions: ThrottleSettings = {
  leading: false,
  trailing: true,
};

type AnyProcedure = (...args: never[]) => unknown;

/**
 * A hook that returns a throttled callback function.
 *
 * @param fn The function to throttle
 * @param wait The time in ms to wait before calling the function
 * @param dependencies The dependencies to watch for changes
 * @param options The throttle options
 */
export function useThrottledCallback<T extends AnyProcedure>(
  fn: T,
  wait = 250,
  dependencies: React.DependencyList = [],
  options: ThrottleSettings = defaultOptions,
): {
  (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T>;
  cancel: () => void;
  flush: () => void;
} {
  const handler = useMemo(
    () => throttle<T>(fn, wait, options),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same contract as useCallback(fn, deps)
    dependencies,
  );

  useEffect(() => {
    return () => {
      handler.cancel();
    };
  }, [handler]);

  return handler;
}
