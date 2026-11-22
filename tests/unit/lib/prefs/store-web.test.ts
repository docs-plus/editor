import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

type Store = typeof import("@/lib/prefs/store-web");

const ui = () => JSON.parse(localStorage.getItem("tinydocy-ui") ?? "null");

beforeEach(() => localStorage.clear());

afterEach(() => {
  localStorage.clear();
  delete process.env.NEXT_PUBLIC_REMEMBER_CHOICES;
  resetModules();
});

describe("web prefs store", () => {
  it("resolves like the boot script: a returning browser is classic", async () => {
    localStorage.setItem("tinydocy-look", "classic");
    const store = await importFresh<Store>("@/lib/prefs/store-web");
    expect(store.getPrefs().page).toEqual({ style: "classic" });
    localStorage.setItem("tinydocy-look", "new");
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    // Unsubscribed readers keep the cache; a subscriber invalidates it.
    const off = store.subscribePrefs(() => {});
    window.dispatchEvent(new StorageEvent("storage", { key: "tinydocy-look" }));
    off();
    expect(store.getPrefs().page).toEqual({ style: "default" });
  });

  it("leaves classic for Default plus the change, keeping other slots", async () => {
    localStorage.setItem("tinydocy-look", "classic");
    localStorage.setItem(
      "tinydocy-ui",
      JSON.stringify({
        v: 1,
        slots: { outlineOpen: { last: false, recent: [] } },
      }),
    );
    const store = await importFresh<Store>("@/lib/prefs/store-web");
    let heard = 0;
    const off = store.subscribePrefs(() => heard++);
    store.setPageKnob("size", 18);
    off();
    expect(heard).toBe(1);
    expect(store.getPrefs().page).toEqual({ style: "default", size: 18 });
    expect(ui()).toEqual({
      v: 1,
      slots: {
        outlineOpen: { last: false, recent: [] },
        page: { last: { style: "default", size: 18 }, recent: [] },
      },
    });
  });

  it("another tab's later change shows here after this tab wrote", async () => {
    const store = await importFresh<Store>("@/lib/prefs/store-web");
    const off = store.subscribePrefs(() => {});
    store.setPageKnob("size", 18);
    expect(store.getPrefs().page).toEqual({ style: "default", size: 18 });
    // Tab B writes the same slot, then its storage event reaches tab A.
    localStorage.setItem(
      "tinydocy-ui",
      JSON.stringify({
        v: 1,
        slots: {
          page: { last: { style: "default", size: 24 }, recent: [] },
        },
      }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key: "tinydocy-ui" }));
    off();
    expect(store.getPrefs().page).toEqual({ style: "default", size: 24 });
  });

  it("a write storage refuses lasts for this tab", async () => {
    const store = await importFresh<Store>("@/lib/prefs/store-web");
    const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const backing = localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => backing.getItem(key),
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: (key: string) => backing.removeItem(key),
        key: (index: number) => backing.key(index),
        get length() {
          return backing.length;
        },
      },
    });
    try {
      store.setPageKnob("width", "wide");
      expect(store.getPrefs().page).toEqual({
        style: "default",
        width: "wide",
      });
    } finally {
      if (real) Object.defineProperty(globalThis, "localStorage", real);
    }
    expect(localStorage.getItem("tinydocy-ui")).toBeNull();
  });

  it("uses the version remembered-choice owns the key with", async () => {
    const { PREFS_VERSION } = await import("@/lib/prefs/keys");
    const { STORAGE_VERSION } = await import("@/lib/remembered-choice");
    expect(PREFS_VERSION).toBe(STORAGE_VERSION);
  });

  it("a remembered-choice write keeps the prefs slots (CHOICE_SLOTS)", async () => {
    const store = await importFresh<Store>("@/lib/prefs/store-web");
    store.setBooleanPref("smartQuotes", false);
    const memory = await import("@/lib/remembered-choice");
    memory.rememberChoice(memory.OUTLINE_OPEN_CHOICE, false);
    expect(ui().slots.smartQuotes).toEqual({ last: false, recent: [] });
  });

  it("turning Remember my place off forgets the stored places", async () => {
    localStorage.setItem("tinydocy-continue", '{"v":1,"docs":{}}');
    const store = await importFresh<Store>("@/lib/prefs/store-web");
    store.setBooleanPref("rememberPlace", false);
    expect(localStorage.getItem("tinydocy-continue")).toBeNull();
    expect(store.getPrefs().rememberPlace).toBe(false);
  });

  it("the kill switch keeps choices for the session only", async () => {
    process.env.NEXT_PUBLIC_REMEMBER_CHOICES = "0";
    const store = await importFresh<Store>("@/lib/prefs/store-web");
    expect(store.getPrefs().page).toEqual({ style: "classic" });
    expect(store.getPrefs().rememberPlace).toBe(false);
    store.setPageKnob("width", "wide");
    store.setA11y({ contrast: "more" });
    expect(store.getPrefs().page).toEqual({ style: "default", width: "wide" });
    expect(store.getPrefs().a11y).toEqual({
      contrast: "more",
      motion: "system",
    });
    expect(localStorage.getItem("tinydocy-ui")).toBeNull();
  });
});
