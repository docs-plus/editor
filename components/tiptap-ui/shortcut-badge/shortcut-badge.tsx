import { Badge } from "@/components/tiptap-ui-primitive/badge";
import { parseShortcutKeys } from "@/lib/shortcuts";

export function ShortcutBadge({ shortcutKeys }: { shortcutKeys?: string }) {
  if (!shortcutKeys) return null;
  return (
    <Badge>
      {parseShortcutKeys({ shortcutKeys }).map((key) => (
        <span key={key}>{key}</span>
      ))}
    </Badge>
  );
}
