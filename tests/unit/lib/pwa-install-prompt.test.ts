import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type InstallPromptModule = typeof import("@/lib/pwa/install-prompt");

function fakeInstallEvent(outcome: "accepted" | "dismissed" = "dismissed") {
  return Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  });
}

function stubInstalled(matches: boolean): void {
  window.matchMedia = vi.fn(
    () => ({ matches }) as unknown as MediaQueryList,
  ) as typeof window.matchMedia;
}

async function loadModule(): Promise<InstallPromptModule> {
  vi.resetModules();
  return import("@/lib/pwa/install-prompt");
}

describe("install prompt store", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    stubInstalled(false);
    window.__TINYDOCY_INSTALL_PROMPT = undefined;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    window.__TINYDOCY_INSTALL_PROMPT = undefined;
    vi.restoreAllMocks();
  });

  it("is unavailable without an event", async () => {
    const { getInstallAvailability } = await loadModule();
    expect(getInstallAvailability()).toBe("none");
  });

  it("offers the prompt once, then hides", async () => {
    const { getInstallAvailability, promptInstall, subscribeInstall } =
      await loadModule();
    const listener = vi.fn();
    const unsubscribe = subscribeInstall(listener);

    const event = fakeInstallEvent("dismissed");
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(getInstallAvailability()).toBe("prompt");
    expect(listener).toHaveBeenCalledTimes(1);

    await expect(promptInstall()).resolves.toBe("dismissed");
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(getInstallAvailability()).toBe("none");
    await expect(promptInstall()).resolves.toBeNull();

    unsubscribe();
  });

  it("picks up an event captured before hydration", async () => {
    window.__TINYDOCY_INSTALL_PROMPT = fakeInstallEvent();
    const { getInstallAvailability } = await loadModule();
    expect(getInstallAvailability()).toBe("prompt");
  });

  it("hides when already installed", async () => {
    stubInstalled(true);
    window.__TINYDOCY_INSTALL_PROMPT = fakeInstallEvent();
    const { getInstallAvailability } = await loadModule();
    expect(getInstallAvailability()).toBe("none");
  });

  it("clears the prompt after appinstalled", async () => {
    window.__TINYDOCY_INSTALL_PROMPT = fakeInstallEvent();
    const { getInstallAvailability } = await loadModule();
    expect(getInstallAvailability()).toBe("prompt");
    window.dispatchEvent(new Event("appinstalled"));
    expect(getInstallAvailability()).toBe("none");
  });

  it("shows the Add to Home Screen hint on iOS", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    );
    const { getInstallAvailability } = await loadModule();
    expect(getInstallAvailability()).toBe("ios");
  });
});
