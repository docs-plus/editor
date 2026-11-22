import { createHash } from "node:crypto";

import {
  LOOK_STORAGE_KEY,
  PREFS_VERSION,
  UI_STORAGE_KEY,
} from "@/lib/prefs/keys";
import {
  LOOK_MARKERS,
  MAX_UI_PAYLOAD_CHARS,
  PAGE_STYLE_IDS,
  PAGE_WIDTHS,
  PREF_DEFAULTS,
  PREF_SLOTS,
  SPACINGS,
  TEXT_SIZES,
} from "@/lib/prefs/schema";
import { THEME_COLOR_DARK } from "@/lib/site-config";
import {
  LEGACY_KEY_PREFIX,
  SYSTEM_DARK_QUERY,
  THEME_COLOR_META_ID,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

/*
 * Server only: the root layout inlines the string and the desktop build
 * hashes it. The editor chunk never imports this module.
 */

const json = JSON.stringify;

/** `NEXT_PUBLIC_REMEMBER_CHOICES`, inlined at build time (§5.3). */
const REMEMBER = process.env.NEXT_PUBLIC_REMEMBER_CHOICES !== "0";

/**
 * The one boot script (preferences design §5.3), first in `<head>`, so
 * nothing paints before it. It takes one snapshot of storage, decides the
 * theme and the page look from it (§5.6), writes the missing theme and
 * look marker, then sets the `.dark` class, the title-bar colour and the
 * `<html>` preference attributes that CSS maps to variables.
 *
 * Its allowlists are interpolated from `lib/prefs/schema.ts`, and the
 * parity test runs it against `resolveBoot()` over the same table, so the
 * two cannot drift. ES5 on purpose: it runs before anything else loads.
 * Any failure keeps the OS theme and today's look (`classic`).
 * A desktop preload that already applied the attributes sets `data-prefs`,
 * and the script then does nothing (one applier per load).
 */
export function buildBootScript(remember: boolean): string {
  return `(function(){var d=document.documentElement;if(d.getAttribute("data-prefs"))return;var K=${json(THEME_STORAGE_KEY)},U=${json(UI_STORAGE_KEY)},L=${json(LOOK_STORAGE_KEY)},X=${json(LEGACY_KEY_PREFIX)},R=${remember},P=${json(THEME_PREFERENCES)},M=${json(LOOK_MARKERS)},Q=${json(PREF_SLOTS)},S=${json(PAGE_STYLE_IDS)},Z=${json(TEXT_SIZES)},W=${json(PAGE_WIDTHS)},G=${json(SPACINGS)},F=${json({ spellcheck: PREF_DEFAULTS.spellcheck, smartQuotes: PREF_DEFAULTS.smartQuotes })},t="system",m="classic",s={},w={},k=[],i,n,e;function r(v){return v!==null&&typeof v==="object"&&!Array.isArray(v)}function h(o,p){return Object.prototype.hasOwnProperty.call(o,p)}function u(x){for(var j=0;j<k.length;j++)if(k[j]!==x&&k[j].indexOf(X)===0)return 1;return 0}try{var l=localStorage,a=l.getItem(K),b=l.getItem(U),c=l.getItem(L);for(i=0;i<l.length;i++)k.push(l.key(i));if(P.indexOf(a)>=0)t=a;else{t=u(K)?"light":"system";w[K]=t}if(M.indexOf(c)>=0)m=c;else{m=u(L)?"classic":"new";if(R)w[L]=m}if(R&&b&&b.length<=${MAX_UI_PAYLOAD_CHARS}){try{var o=JSON.parse(b);if(r(o)&&o.v===${PREFS_VERSION}&&r(o.slots))for(i=0;i<Q.length;i++){n=Q[i];if(h(o.slots,n)&&r(e=o.slots[n])&&h(e,"last"))s[n]=e.last}}catch(x){}}}catch(x){t="system";m="classic";s={};w={}}for(n in w)try{localStorage.setItem(n,w[n])}catch(x){}var p=s.page,g=!R||m==="classic"?"classic":"default",y=r(s.a11y)?s.a11y:{};function f(q,v){d.setAttribute(q,v)}if(r(p)&&S.indexOf(p.style)>=0){g=p.style;f("data-page-style",g);if(Z.indexOf(p.size)>=0)f("data-text-size",String(p.size));if(W.indexOf(p.width)>=0)f("data-page-width",p.width);if(G.indexOf(p.spacing)>=0)f("data-spacing",p.spacing)}else f("data-page-style",g);if(y.contrast==="more")f("data-contrast","more");if(y.motion==="reduce")f("data-motion","reduce");if((typeof s.smartQuotes==="boolean"?s.smartQuotes:F.smartQuotes)===false)f("data-smart-quotes","off");if((typeof s.spellcheck==="boolean"?s.spellcheck:F.spellcheck)===false)f("spellcheck","false");f("data-prefs","1");try{if(t==="dark"||(t==="system"&&matchMedia(${json(SYSTEM_DARK_QUERY)}).matches)){d.classList.add("dark");var z=document.createElement("meta");z.name="theme-color";z.id=${json(THEME_COLOR_META_ID)};z.content=${json(THEME_COLOR_DARK)};document.head.prepend(z)}}catch(x){}})();`;
}

/** The script this build inlines in every HTML response. */
export const BOOT_SCRIPT = buildBootScript(REMEMBER);

/**
 * Its CSP source, `'sha256-…'` over the exact UTF-8 string. The desktop
 * CSP (P2.5) allows the inline script by this hash.
 */
export const BOOT_SCRIPT_SHA256 = `'sha256-${createHash("sha256").update(BOOT_SCRIPT, "utf8").digest("base64")}'`;
