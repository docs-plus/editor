"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
// Type-only: this lazy chunk must not import `lib/user-identity` at runtime.
// A module both the editor chunk and this one import is split out of the
// editor group, which costs it more than the module itself.
import type { NameResult, UserIdentity } from "@/lib/user-identity";
import { cn } from "@/lib/utils";

export interface UserIdentityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The identity the drafts start from; mount the dialog once per opening. */
  currentUser: UserIdentity;
  /** The caret colour swatches (`CARET_COLORS`). */
  colors: readonly string[];
  /** Validates and stores; the dialog closes only when this returns `ok`. */
  onSave: (identity: UserIdentity) => NameResult;
}

type NameError = Extract<NameResult, { ok: false }>["error"];

const NAME_ERROR_ID = "user-identity-name-error";

const NAME_ERROR_TEXT: Record<NameError, string> = {
  empty: "Enter a name.",
  too_long: "Use 32 characters or fewer.",
};

export function UserIdentityDialog({
  open,
  onOpenChange,
  currentUser,
  colors,
  onSave,
}: UserIdentityDialogProps) {
  const [draftName, setDraftName] = useState(currentUser.name);
  const [draftColor, setDraftColor] = useState(currentUser.color);
  const [nameError, setNameError] = useState<NameError | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    const result = onSave({ name: draftName, color: draftColor });
    if (result.ok) {
      onOpenChange(false);
      return;
    }
    setNameError(result.error);
    nameInputRef.current?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your Identity</DialogTitle>
          <DialogDescription>
            Choose a display name and cursor color visible to collaborators.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label htmlFor="user-identity-name" className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Name</span>
            <Input
              ref={nameInputRef}
              id="user-identity-name"
              value={draftName}
              onChange={(e) => {
                setDraftName(e.target.value);
                setNameError(null);
              }}
              placeholder="Enter your name"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? NAME_ERROR_ID : undefined}
              autoFocus
            />
          </label>
          {nameError && (
            <p
              id={NAME_ERROR_ID}
              role="alert"
              className="text-sm text-destructive"
            >
              {NAME_ERROR_TEXT[nameError]}
            </p>
          )}

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">Cursor Color</legend>
            <div className="flex flex-wrap gap-2 pt-1">
              {colors.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Select color ${color}`}
                  aria-pressed={draftColor === color}
                  className={cn(
                    "size-7 rounded-full transition-shadow",
                    draftColor === color
                      ? "ring-2 ring-offset-2 ring-offset-background ring-foreground"
                      : "hover:ring-2 hover:ring-offset-2 hover:ring-offset-background hover:ring-muted-foreground/50",
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => setDraftColor(color)}
                />
              ))}
            </div>
          </fieldset>
        </div>

        <DialogFooter>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
