import { Typography } from "@tiptap/extension-typography";

/**
 * Smart quotes and dashes, gated by the `smartQuotes` preference (owner
 * Q2, preferences design §5.10). Each rule reads the `<html>` attribute
 * the boot script sets when it is off, so the extensions never rebuild;
 * a `null` handler makes Tiptap insert the typed text as is. Code blocks
 * and inline code never get input rules.
 */
export const SmartTypography = Typography.extend({
  addInputRules() {
    const rules = this.parent?.() ?? [];
    for (const rule of rules) {
      const handler = rule.handler;
      rule.handler = (props) =>
        document.documentElement.dataset.smartQuotes === "off"
          ? null
          : handler(props);
    }
    return rules;
  },
});
