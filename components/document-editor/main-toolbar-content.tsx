"use client";

import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/document-editor/theme-toggle";
import {
  AaCollapseMenu,
  ActionButton,
  ColorCollapseButton,
  ColorControls,
  FontSizeStepper,
  InsertMenu,
  ListControl,
  ParagraphCollapseMenu,
  SizeCollapseMenu,
  SlotCollapseButton,
  ViewCollapseMenu,
} from "@/components/smart-toolbar";
import { ContextSlot } from "@/components/smart-toolbar/context-slot/context-slot";
import { AlignMenu } from "@/components/smart-toolbar/row/align-menu";
import { OverflowMenu } from "@/components/smart-toolbar/row/overflow-menu";
import { StyleMenu } from "@/components/smart-toolbar/row/style-menu";
import { FilterToolbarButton } from "@/components/tiptap-ui/heading-filter";
import { Spacer } from "@/components/ui/spacer";
import { ToolbarGroup, ToolbarSeparator } from "@/components/ui/toolbar";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { PanelLeftIcon } from "@/lib/icons";

interface MainToolbarContentProps {
  onTocToggle: () => void;
  onFilterToggle: () => void;
  tocVisible: boolean;
  /** The outline is an overlay (< 950px): opening it moves focus into it. */
  outlineOverlay?: boolean;
  filterActive: boolean;
}

type Tier = "t2" | "t3" | "t4" | "t5";

/**
 * Marks an item with the responsive tier at which it hides (contract
 * §5.3). `display: contents`, so the wrapper never changes layout or the
 * roving order; D2's container queries hide it by this attribute.
 */
function Collapse({ tier, children }: { tier: Tier; children: ReactNode }) {
  return (
    <span data-collapse-tier={tier} className="contents">
      {children}
    </span>
  );
}

/**
 * A stand-in shown only below its tier (spec §4.6), in place of the
 * `Collapse` group of the same tier. Hidden by default in
 * `smart-toolbar.scss`, so wide rows never render it visibly.
 */
function StandIn({ tier, children }: { tier: Tier; children: ReactNode }) {
  return (
    <span data-collapse-standin={tier} className="contents">
      {children}
    </span>
  );
}

/**
 * The sorted row (spec §4.1). It never reorders: every control stays in
 * place in every context, disabled with a reason when it cannot run.
 *
 * `[Outline Filter] │ ↶ ↷ │ Style ▾ · Size │ B I U S · colour · link │
 * Align ▾ · List ▾ · ⇤ ⇥ │ [slot] │ + Insert ▾ · ⋯ │ … Theme`
 *
 * Each group root carries `data-toolbar-group` for D2's responsive ladder.
 */
export function MainToolbarContent({
  onTocToggle,
  onFilterToggle,
  tocVisible,
  outlineOverlay = false,
  filterActive,
}: MainToolbarContentProps) {
  return (
    <>
      <ToolbarGroup data-toolbar-group="view" aria-label="View">
        <Collapse tier="t4">
          <ToolbarButton
            onClick={onTocToggle}
            aria-label="Toggle outline"
            tooltip="Toggle outline"
            isActive={tocVisible}
          >
            <PanelLeftIcon />
          </ToolbarButton>
          <FilterToolbarButton
            onClick={onFilterToggle}
            isActive={filterActive}
          />
        </Collapse>
        <StandIn tier="t4">
          <ViewCollapseMenu
            onTocToggle={onTocToggle}
            onFilterToggle={onFilterToggle}
            tocVisible={tocVisible}
            outlineOverlay={outlineOverlay}
            filterActive={filterActive}
          />
        </StandIn>
      </ToolbarGroup>

      <Spacer />

      <ToolbarGroup data-toolbar-group="history" aria-label="History">
        <ActionButton id="history.undo" />
        <ActionButton id="history.redo" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup data-toolbar-group="style" aria-label="Text style">
        <StyleMenu />
      </ToolbarGroup>
      <ToolbarGroup data-toolbar-group="size" aria-label="Text size">
        <Collapse tier="t2">
          <FontSizeStepper />
        </Collapse>
        <StandIn tier="t2">
          <SizeCollapseMenu />
        </StandIn>
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup data-toolbar-group="marks" aria-label="Formatting">
        <ActionButton id="mark.bold" />
        <ActionButton id="mark.italic" />
        <Collapse tier="t5">
          <ActionButton id="mark.underline" />
          <ActionButton id="mark.strike" />
        </Collapse>
        <StandIn tier="t5">
          <AaCollapseMenu />
        </StandIn>
      </ToolbarGroup>
      <ToolbarGroup data-toolbar-group="color" aria-label="Colour">
        <Collapse tier="t4">
          <ColorControls />
        </Collapse>
        <StandIn tier="t4">
          <ColorCollapseButton />
        </StandIn>
      </ToolbarGroup>
      <ToolbarGroup data-toolbar-group="link" aria-label="Link">
        <ActionButton id="mark.link" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup data-toolbar-group="paragraph" aria-label="Paragraph">
        <Collapse tier="t3">
          <AlignMenu />
        </Collapse>
        <div data-toolbar-group="list" className="contents">
          <ListControl />
        </div>
        <Collapse tier="t3">
          <ActionButton id="indent.outdent" />
          <ActionButton id="indent.indent" />
        </Collapse>
        <StandIn tier="t3">
          <ParagraphCollapseMenu />
        </StandIn>
      </ToolbarGroup>

      <ToolbarSeparator />

      <div data-toolbar-group="slot" className="contents">
        <Collapse tier="t3">
          <ContextSlot />
        </Collapse>
        <StandIn tier="t3">
          <SlotCollapseButton />
        </StandIn>
      </div>

      <ToolbarSeparator />

      <ToolbarGroup data-toolbar-group="insert" aria-label="Insert">
        <InsertMenu />
      </ToolbarGroup>
      <ToolbarGroup data-toolbar-group="more" aria-label="More">
        <OverflowMenu />
      </ToolbarGroup>

      <Spacer />

      <ToolbarGroup data-toolbar-group="theme" aria-label="Theme">
        <Collapse tier="t2">
          <ThemeToggle />
        </Collapse>
      </ToolbarGroup>
    </>
  );
}
