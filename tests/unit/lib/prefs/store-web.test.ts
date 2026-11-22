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
