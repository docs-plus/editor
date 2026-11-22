/**
 * N5: every device chooser is dismissed. Electron is faked: hardenSession
 * registers its handlers on it, and the test fires them.
 */
import { expect, mock, test } from "bun:test";

type Handler = (...args: unknown[]) => unknown;
const sessionHandlers = new Map<string, Handler>();
const appHandlers = new Map<string, Handler>();
const noop = () => {};

mock.module("electron", () => ({
  app: {
    on: (event: string, handler: Handler) => appHandlers.set(event, handler),
    isReady: () => true,
  },
  shell: { openExternal: async () => {} },
  session: {
    defaultSession: {
      setPermissionRequestHandler: noop,
      setPermissionCheckHandler: noop,
      setDevicePermissionHandler: noop,
      webRequest: { onBeforeSendHeaders: noop },
      on: (event: string, handler: Handler) =>
        sessionHandlers.set(event, handler),
    },
  },
}));

function fire(handler: Handler | undefined, ...beforeCallback: unknown[]) {
  let prevented = false;
  let answer: unknown = "unset";
  handler?.(
    {
      preventDefault: () => {
        prevented = true;
      },
    },
    ...beforeCallback,
    (value: unknown) => {
      answer = value;
    },
  );
  return { prevented, answer };
}

test("Bluetooth, HID, serial and USB choosers are all dismissed", async () => {
  const { hardenSession } = await import("@/desktop/main/session-hardening");
  hardenSession();

  for (const [event, args] of [
    ["select-hid-device", [{}]],
    ["select-serial-port", [[], {}]],
    ["select-usb-device", [{}]],
  ] as const) {
    const result = fire(sessionHandlers.get(event), ...args);
    expect({ event, ...result }).toMatchObject({ event, prevented: true });
    expect(result.answer === "" || result.answer === undefined).toBe(true);
  }

  const contentsHandlers = new Map<string, Handler>();
  const contents = {
    id: 7,
    on: (event: string, handler: Handler) =>
      contentsHandlers.set(event, handler),
    once: noop,
    setWindowOpenHandler: (handler: Handler) =>
      contentsHandlers.set("window-open", handler),
  };
  appHandlers.get("web-contents-created")?.({}, contents);
  expect(fire(contentsHandlers.get("select-bluetooth-device"), [])).toEqual({
    prevented: true,
    answer: "",
  });
  // N2: window.open is always denied.
  expect(
    contentsHandlers.get("window-open")?.({ url: "https://example.com/" }),
  ).toEqual({ action: "deny" });
});
