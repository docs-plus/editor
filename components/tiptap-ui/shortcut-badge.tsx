import { Badge } from "@/components/tiptap-ui-primitive/badge";
import { parseShortcutKeys } from "@/lib/tiptap-utils";

export function ShortcutBadge({ shortcutKeys }: { shortcutKeys?: string }) {
  if (!shortcutKeys) return null;
  return (
    <Badge>
      {parseShortcutKeys({ shortcutKeys }).map((key, index) => (
        <span key={index}>{key}</span>
      ))}
    </Badge>
  );
}
