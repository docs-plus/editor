# Upstream issue: apply `isAllowedUri` in `parseHTML` and `renderHTML`

Ready to file against `@docs.plus/extension-hyperlink` (seen on 2.3.0). Not
filed yet. TinyDocy works around it in
`components/document-editor/document-editor-config.ts` (`isWebLink`,
`LinkPolicyHyperlink`); drop the workaround when a release fixes it.

---

**Title:** `isAllowedUri` is skipped by HTML paste and by rendering, so a
refused scheme still becomes a live link

## Summary

`isAllowedUri` is documented as the URI policy hook, and it is applied by
`setHyperlink`, autolink, the input and paste rules and the read gate
(`forRead`, which every package-made open goes through). Two boundaries
ignore it and use only `isSafeHref`, the built-in denylist
(`javascript|data|vbscript|file|blob`):

1. **`parseHTML`**: the `a[href]` rule's `getAttrs` returns
   `isSafeHref(href) ? null : false`. A pasted `<a href="ms-msdt:…">` keeps
   its mark however strict the host's `isAllowedUri` is.
2. **`renderHTML`**: an href that fails the gate is blanked only when
   `isSafeHref` fails, and then to `href=""`. A mark that arrives without
   going through a command (a Yjs update from a collaborator, an older
   document, `insertContent` HTML, Markdown import) renders as a live
   `<a href="ms-msdt:…">`.

The click handler's own opens are gated, but the anchor itself is live: the
browser's native middle-click, context menu "Open link in new tab", drag to
the tab bar, and any host code that reads `a.href` all follow it. `href=""`
for the denylisted case is a live link too (it resolves to the current
page).

## Risk

Hosts set `isAllowedUri` to keep links to the web (`https`, `http`,
`mailto`). Schemes outside the denylist are handed to OS protocol handlers:
`ms-msdt:` (Follina, CVE-2022-30190), `search-ms:` (remote search results
that look like local folders), `ms-officecmd:`, `smb:` / `file`-like UNC
paths (NTLM hash leaks), `vscode:` and other app schemes with their own
command surfaces. In a collaborative editor any collaborator can deliver
such a link to every reader.

## Minimal repro

```ts
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Hyperlink } from "@docs.plus/extension-hyperlink";

const webOnly = (uri: string) => /^(?:https?|mailto):/i.test(uri);
const editor = new Editor({
  element: document.createElement("div"),
  extensions: [
    StarterKit.configure({ link: false }),
    Hyperlink.configure({ isAllowedUri: webOnly }),
  ],
});

editor.commands.setHyperlink({ href: "ms-msdt:/id x" }); // false: refused, as expected

// 1. Paste path: the mark is kept.
editor.commands.insertContent('<p><a href="ms-msdt:/id x">paste</a></p>');
editor.view.dom.querySelector("a")?.getAttribute("href"); // "ms-msdt:/id x"

// 2. Stored marks (Yjs, setContent): rendered as a live link.
editor.commands.setContent({
  type: "doc",
  content: [{
    type: "paragraph",
    content: [{
      type: "text",
      text: "stored",
      marks: [{ type: "hyperlink", attrs: { href: "search-ms:query=x" } }],
    }],
  }],
});
editor.view.dom.querySelector("a")?.getAttribute("href"); // "search-ms:query=x"
```

Expected: no mark after the paste (the text stays), and no `href` attribute
on the stored link.

## Proposed change

Use the composed gate (the one `forRead` uses: `isSafeHref` and then
`isAllowedUri`) at both boundaries, and drop the attribute instead of
blanking it:

```ts
parseHTML() {
  return [
    { tag: ".hyperlink-icon", ignore: true, priority: 1000 },
    {
      tag: "a[href]",
      priority: 51,
      getAttrs: (node) => {
        if (typeof node === "string") return false;
        return gate(node.getAttribute("href") ?? "") ? null : false;
      },
    },
  ];
},

renderHTML({ HTMLAttributes }) {
  const { href, ...rest } = HTMLAttributes;
  const attrs = gate(href) ? HTMLAttributes : rest; // no href: not a link
  return ["a", mergeAttributes(this.options.HTMLAttributes, attrs), 0];
},
```

`gate` here is `composeGate({ isAllowedUri, protocols, defaultProtocol })`,
already built per editor in `createLinkContext`; exposing it to the mark
(for example through `storage.context.urls.forRead(href).navigable`) avoids
a second instance. The same applies to `parseMarkdown` and
`renderMarkdown`, which also use `isSafeHref` alone.

A link with no `href` still renders as `<a>`, so it keeps its text and
styling and can still be selected, edited or removed; it just cannot be
followed.

Related, lower priority: the `title` attribute is parsed from pasted HTML,
so a pasted link can carry a stranger's tooltip ("Your bank: click to
verify"). An option to ignore pasted titles (or ignoring them by default)
would help hosts that treat content as untrusted.

## Our workaround

`Hyperlink.extend()` that wraps the parent's `a[href]` rule's `getAttrs`
with `this.options.isAllowedUri`, post-processes the parent's `renderHTML`
to delete `href` when the policy refuses it, and overrides the `title`
attribute's `parseHTML` to return `null`. It costs about 100 B gz on top of
the policy itself and has to track the parent's rule order.
