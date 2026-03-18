"use client";

import { useState } from "react";

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
import { CARET_COLORS, type UserIdentity } from "@/lib/user-identity";
import { cn } from "@/lib/utils";

interface UserIdentityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUser: UserIdentity;
  onSave: (identity: UserIdentity) => void;
}

export function UserIdentityDialog({
  open,
  onOpenChange,
  currentUser,
  onSave,
}: UserIdentityDialogProps) {
  const [draftName, setDraftName] = useState(currentUser.name);
  const [draftColor, setDraftColor] = useState(currentUser.color);

  const handleOpen = (next: boolean) => {
    if (next) {
      setDraftName(currentUser.name);
      setDraftColor(currentUser.color);
    }
    onOpenChange(next);
  };

  const handleSave = () => {
    const name = draftName.trim() || currentUser.name;
    onSave({ name, color: draftColor });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
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
              id="user-identity-name"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Enter your name"
              maxLength={30}
              autoFocus
            />
          </label>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">Cursor Color</legend>
            <div className="flex flex-wrap gap-2 pt-1">
              {CARET_COLORS.map((color) => (
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
