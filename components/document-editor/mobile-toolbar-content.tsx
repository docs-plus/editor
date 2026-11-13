"use client";

import { ColorControls } from "@/components/smart-toolbar/color-controls";
import { FontSizeStepper } from "@/components/smart-toolbar/font-size-stepper";
import { ToolbarGroup, ToolbarSeparator } from "@/components/ui/toolbar";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { ArrowLeftIcon } from "@/lib/icons";

interface MobileToolbarContentProps {
  onBack: () => void;
}

/**
 * Secondary phone panel: font size and the colour pair, so phones reach
 * text colour, highlight and size (contract §1.3 minimum for the phone
 * bar). Targets grow to 44×44 on touch (`smart-toolbar.scss`), and the
 * panel wraps to a second line at 360px rather than scrolling sideways.
 */
export function MobileToolbarContent({ onBack }: MobileToolbarContentProps) {
  return (
    <div className="st-phone-panel">
      <ToolbarGroup>
        <ToolbarButton
          onClick={onBack}
          size="sm"
          className="st-phone-back"
          aria-label="Back to all tools"
          tooltip="Back to all tools"
        >
          <ArrowLeftIcon />
        </ToolbarButton>
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <FontSizeStepper />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <ColorControls />
      </ToolbarGroup>
    </div>
  );
}
