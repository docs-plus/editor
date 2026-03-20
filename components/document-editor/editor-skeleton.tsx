export function EditorSkeleton() {
  return (
    <div className="document-editor-wrapper" aria-busy="true">
      <div className="editor-skeleton">
        <div className="editor-skeleton-toolbar" />
        <div className="editor-skeleton-content">
          <div className="editor-skeleton-line editor-skeleton-line--wide" />
          <div className="editor-skeleton-line editor-skeleton-line--medium" />
          <div className="editor-skeleton-line editor-skeleton-line--narrow" />
        </div>
      </div>
    </div>
  );
}
