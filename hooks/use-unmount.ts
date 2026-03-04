import { useEffect, useRef } from "react";

/**
 * Hook that executes a callback when the component unmounts.
 */
export const useUnmount = (callback: () => void) => {
  const ref = useRef(callback);
  ref.current = callback;

  useEffect(
    () => () => {
      ref.current();
    },
    [],
  );
};

export default useUnmount;
