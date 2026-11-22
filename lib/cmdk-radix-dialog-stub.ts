/**
 * Stands in for `@radix-ui/react-dialog` in the browser bundle
 * (`turbopack.resolveAlias` in `next.config.ts`). cmdk is its only importer:
 * cmdk's module builds `Command.Dialog` from it inside an `Object.assign`
 * the minifier must keep, so the whole Radix Dialog stack (focus scope,
 * dismissable layer, scroll lock, aria-hidden) rode in the palette chunk
 * though nothing renders it. The palette wraps cmdk's parts in our own
 * base-ui `Dialog` (`components/ui/command.tsx`); `Command.Dialog` and
 * `CommandDialog` from cmdk throw if rendered.
 */
function unavailable(): never {
  throw new Error(
    "cmdk's Command.Dialog is not bundled: wrap the Command parts in components/ui/dialog",
  );
}

export const Root = unavailable;
export const Portal = unavailable;
export const Overlay = unavailable;
export const Content = unavailable;
