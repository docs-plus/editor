"use client";

/**
 * shadcn `Command` (base-nova look) over cmdk's named parts. Never import
 * cmdk's composite `Command` (it carries `Command.Dialog` and Radix Dialog
 * into the bundle); the palette wraps these parts in our own `Dialog`.
 */
import {
  CommandEmpty as CommandEmptyPrimitive,
  CommandGroup as CommandGroupPrimitive,
  CommandInput as CommandInputPrimitive,
  CommandItem as CommandItemPrimitive,
  CommandList as CommandListPrimitive,
  CommandRoot,
} from "cmdk";
import type * as React from "react";

import { SearchIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandRoot>) {
  return (
    <CommandRoot
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandInputPrimitive>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-11 items-center gap-2 border-b px-3"
    >
      <SearchIcon className="size-4 shrink-0 opacity-50" aria-hidden="true" />
      <CommandInputPrimitive
        data-slot="command-input"
        className={cn(
          "flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandListPrimitive>) {
  return (
    <CommandListPrimitive
      data-slot="command-list"
      className={cn(
        "max-h-[min(24rem,60vh)] scroll-py-1 overflow-x-hidden overflow-y-auto overscroll-contain",
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandEmptyPrimitive>) {
  return (
    <CommandEmptyPrimitive
      data-slot="command-empty"
      className={cn(
        "py-6 text-center text-sm text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandGroupPrimitive>) {
  return (
    <CommandGroupPrimitive
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandItemPrimitive>) {
  return (
    <CommandItemPrimitive
      data-slot="command-item"
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // The active option is never colour-only (WCAG 1.4.11): an
        // inline-start bar in the foreground colour, and in forced colours
        // a Highlight fill (backgrounds are dropped there).
        "data-[selected=true]:before:absolute data-[selected=true]:before:inset-y-1 data-[selected=true]:before:start-0 data-[selected=true]:before:w-0.5 data-[selected=true]:before:rounded-full data-[selected=true]:before:bg-foreground data-[selected=true]:before:content-['']",
        "forced-colors:outline-none forced-colors:data-[selected=true]:forced-color-adjust-none forced-colors:data-[selected=true]:bg-[Highlight] forced-colors:data-[selected=true]:text-[HighlightText] forced-colors:data-[selected=true]:before:bg-[HighlightText]",
        className,
      )}
      {...props}
    />
  );
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground in-data-[selected=true]:text-accent-foreground forced-colors:in-data-[selected=true]:text-[HighlightText]",
        className,
      )}
      {...props}
    />
  );
}

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
};
