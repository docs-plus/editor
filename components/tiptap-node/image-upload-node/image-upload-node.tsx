"use client";

import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CloseIcon, CloudUploadIcon } from "@/lib/icons";
import "@/components/tiptap-node/image-upload-node/image-upload-node.scss";
import { focusNextNode, isValidPosition } from "@/lib/editor-utils";

export interface FileItem {
  /**
   * Unique identifier for the file item
   */
  id: string;
  /**
   * The actual File object being uploaded
   */
  file: File;
  /**
   * Current upload progress as a percentage (0-100)
   */
  progress: number;
  /**
   * Current status of the file upload process
   * @default "uploading"
   */
  status: "uploading" | "success" | "error";

  /**
   * URL to the uploaded file, available after successful upload
   * @optional
   */
  url?: string;
  /**
   * Controller that can be used to abort the upload process
   * @optional
   */
  abortController?: AbortController;
}

export interface UploadOptions {
  /**
   * Maximum allowed file size in bytes
   */
  maxSize: number;
  /**
   * Maximum number of files that can be uploaded
   */
  limit: number;
  /**
   * String specifying acceptable file types (MIME types or extensions)
   * @example ".jpg,.png,image/jpeg" or "image/*"
   */
  accept: string;
  /**
   * Function that handles the actual file upload process
   * @param {File} file - The file to be uploaded
   * @param {Function} onProgress - Callback function to report upload progress
   * @param {AbortSignal} signal - Signal that can be used to abort the upload
   * @returns {Promise<string>} Promise resolving to the URL of the uploaded file
   */
  upload: (
    file: File,
    onProgress: (event: { progress: number }) => void,
    signal: AbortSignal,
  ) => Promise<string>;
  /**
   * Callback triggered when a file is uploaded successfully
   * @param {string} url - URL of the successfully uploaded file
   * @optional
   */
  onSuccess?: (url: string) => void;
  /**
   * Callback triggered when an error occurs during upload
   * @param {Error} error - The error that occurred
   * @optional
   */
  onError?: (error: Error) => void;
}

/**
 * Custom hook for managing multiple file uploads with progress tracking and cancellation
 */
function useFileUpload(options: UploadOptions) {
  const [fileItems, setFileItems] = useState<FileItem[]>([]);
  const fileItemsRef = useRef<FileItem[]>([]);

  useEffect(() => {
    fileItemsRef.current = fileItems;
  }, [fileItems]);

  useEffect(() => {
    return () => {
      // biome-ignore lint/suspicious/useIterableCallbackReturn: abort() returns void, false positive
      fileItemsRef.current.forEach((item) => item.abortController?.abort());
    };
  }, []);

  const uploadFile = async (file: File): Promise<string | null> => {
    if (options.maxSize > 0 && file.size > options.maxSize) {
      const error = new Error(
        `File size exceeds maximum allowed (${options.maxSize / 1024 / 1024}MB)`,
      );
      options.onError?.(error);
      return null;
    }

    const abortController = new AbortController();
    const fileId = crypto.randomUUID();

    const newFileItem: FileItem = {
      id: fileId,
      file,
      progress: 0,
      status: "uploading",
      abortController,
    };

    setFileItems((prev) => [...prev, newFileItem]);

    try {
      if (!options.upload) {
        throw new Error("Upload function is not defined");
      }

      const url = await options.upload(
        file,
        (event: { progress: number }) => {
          setFileItems((prev) =>
            prev.map((item) =>
              item.id === fileId ? { ...item, progress: event.progress } : item,
            ),
          );
        },
        abortController.signal,
      );

      if (!url) throw new Error("Upload failed: No URL returned");

      if (!abortController.signal.aborted) {
        setFileItems((prev) =>
          prev.map((item) =>
            item.id === fileId
              ? { ...item, status: "success", url, progress: 100 }
              : item,
          ),
        );
        options.onSuccess?.(url);
        return url;
      }

      return null;
    } catch (error) {
      if (!abortController.signal.aborted) {
        setFileItems((prev) =>
          prev.map((item) =>
            item.id === fileId
              ? { ...item, status: "error", progress: 0 }
              : item,
          ),
        );
        options.onError?.(
          error instanceof Error ? error : new Error("Upload failed"),
        );
      }
      return null;
    }
  };

  const uploadFiles = async (files: File[]): Promise<string[]> => {
    if (!files || files.length === 0) {
      options.onError?.(new Error("No files to upload"));
      return [];
    }

    if (options.limit && files.length > options.limit) {
      options.onError?.(
        new Error(
          `Maximum ${options.limit} file${options.limit === 1 ? "" : "s"} allowed`,
        ),
      );
      return [];
    }

    // Upload all files concurrently
    const uploadPromises = files.map((file) => uploadFile(file));
    const results = await Promise.all(uploadPromises);

    // Filter out null results (failed uploads)
    return results.filter((url): url is string => url !== null);
  };

  const removeFileItem = (fileId: string) => {
    setFileItems((prev) => {
      const fileToRemove = prev.find((item) => item.id === fileId);
      if (fileToRemove?.abortController) {
        fileToRemove.abortController.abort();
      }
      return prev.filter((item) => item.id !== fileId);
    });
  };

  const clearAllFiles = () => {
    fileItems.forEach((item) => {
      if (item.abortController) {
        item.abortController.abort();
      }
    });
    setFileItems([]);
  };

  return {
    fileItems,
    uploadFile,
    uploadFiles,
    removeFileItem,
    clearAllFiles,
  };
}

const FileIcon: React.FC = () => (
  // biome-ignore lint/a11y/noSvgWithoutTitle: decorative icon
  <svg
    width="43"
    height="57"
    viewBox="0 0 43 57"
    fill="currentColor"
    className="tiptap-image-upload-dropzone-rect-primary"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M0.75 10.75C0.75 5.64137 4.89137 1.5 10 1.5H32.3431C33.2051 1.5 34.0317 1.84241 34.6412 2.4519L40.2981 8.10876C40.9076 8.71825 41.25 9.5449 41.25 10.4069V46.75C41.25 51.8586 37.1086 56 32 56H10C4.89137 56 0.75 51.8586 0.75 46.75V10.75Z"
      fill="currentColor"
      fillOpacity="0.11"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

const FileCornerIcon: React.FC = () => (
  // biome-ignore lint/a11y/noSvgWithoutTitle: decorative icon
  <svg
    width="10"
    height="10"
    className="tiptap-image-upload-dropzone-rect-secondary"
    viewBox="0 0 10 10"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M0 0.75H0.343146C1.40401 0.75 2.42143 1.17143 3.17157 1.92157L8.82843 7.57843C9.57857 8.32857 10 9.34599 10 10.4069V10.75H4C1.79086 10.75 0 8.95914 0 6.75V0.75Z"
      fill="currentColor"
    />
  </svg>
);

interface ImageUploadDragAreaProps {
  /**
   * Callback function triggered when files are dropped or selected
   * @param {File[]} files - Array of File objects that were dropped or selected
   */
  onFile: (files: File[]) => void;
  /**
   * Accepted file types (MIME types or extensions)
   * @optional
   */
  accept?: string;
  /**
   * Optional child elements to render inside the drag area
   * @optional
   * @default undefined
   */
  children?: React.ReactNode;
}

/**
 * A component that creates a drag-and-drop area for image uploads
 */
const ImageUploadDragArea: React.FC<ImageUploadDragAreaProps> = ({
  onFile,
  accept,
  children,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragActive(false);
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const validFiles = files.filter((f) => {
      if (!accept || accept === "*" || accept === "*/*") return true;
      return accept.split(",").some((type) => {
        const t = type.trim();
        if (t.endsWith("/*")) return f.type.startsWith(t.slice(0, -1));
        if (t.startsWith(".")) return f.name.toLowerCase().endsWith(t);
        return f.type === t;
      });
    });
    if (validFiles.length === 0) return;
    onFile(validFiles);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop area, no keyboard equivalent needed
    <div
      className={`tiptap-image-upload-drag-area ${isDragActive ? "drag-active" : ""} ${isDragOver ? "drag-over" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
    </div>
  );
};

interface ImageUploadPreviewProps {
  /**
   * The file item to preview
   */
  fileItem: FileItem;
  /**
   * Callback to remove this file from upload queue
   */
  onRemove: () => void;
}

/**
 * Component that displays a preview of an uploading file with progress
 */
const ImageUploadPreview: React.FC<ImageUploadPreviewProps> = ({
  fileItem,
  onRemove,
}) => {
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
  };

  return (
    <div className="tiptap-image-upload-preview">
      {fileItem.status === "uploading" && (
        <div
          className="tiptap-image-upload-progress"
          style={{ width: `${fileItem.progress}%` }}
        />
      )}

      <div className="tiptap-image-upload-preview-content">
        <div className="tiptap-image-upload-file-info">
          <div className="tiptap-image-upload-file-icon">
            <CloudUploadIcon size={24} className="tiptap-image-upload-icon" />
          </div>
          <div className="tiptap-image-upload-details">
            <span className="tiptap-image-upload-text">
              {fileItem.file.name}
            </span>
            <span className="tiptap-image-upload-subtext">
              {formatFileSize(fileItem.file.size)}
            </span>
          </div>
        </div>
        <div className="tiptap-image-upload-actions">
          {fileItem.status === "uploading" && (
            <span className="tiptap-image-upload-progress-text">
              {fileItem.progress}%
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <CloseIcon />
          </Button>
        </div>
      </div>
    </div>
  );
};

const DropZoneContent: React.FC<{ maxSize: number; limit: number }> = ({
  maxSize,
  limit,
}) => (
  <>
    <div className="tiptap-image-upload-dropzone">
      <FileIcon />
      <FileCornerIcon />
      <div className="tiptap-image-upload-icon-container">
        <CloudUploadIcon size={24} className="tiptap-image-upload-icon" />
      </div>
    </div>

    <div className="tiptap-image-upload-content">
      <span className="tiptap-image-upload-text">
        <em>Click to upload</em> or drag and drop
      </span>
      <span className="tiptap-image-upload-subtext">
        Maximum {limit} file{limit === 1 ? "" : "s"}, {maxSize / 1024 / 1024}MB
        each.
      </span>
    </div>
  </>
);

export const ImageUploadNode: React.FC<NodeViewProps> = (props) => {
  const { accept, limit, maxSize } = props.node.attrs;
  const inputRef = useRef<HTMLInputElement>(null);
  const extension = props.extension;

  const uploadOptions: UploadOptions = {
    maxSize,
    limit,
    accept,
    upload: extension.options.upload,
    onSuccess: extension.options.onSuccess,
    onError: extension.options.onError,
  };

  const { fileItems, uploadFile, removeFileItem, clearAllFiles } =
    useFileUpload(uploadOptions);

  const handleUpload = async (files: File[]) => {
    const results = await Promise.all(
      files.map(async (file) => {
        const url = await uploadFile(file);
        return url ? { url, file } : null;
      }),
    );
    const successful = results.filter(
      (r): r is { url: string; file: File } => r !== null,
    );

    if (successful.length > 0) {
      const pos = props.getPos();

      if (isValidPosition(pos)) {
        const imageNodes = successful.map(({ url, file }) => ({
          type: extension.options.type,
          attrs: {
            src: url,
            alt: file.name.replace(/\.[^/.]+$/, "") || "unknown",
            title: file.name.replace(/\.[^/.]+$/, "") || "unknown",
          },
        }));

        props.editor
          .chain()
          .focus()
          .deleteRange({ from: pos, to: pos + props.node.nodeSize })
          .insertContentAt(pos, imageNodes)
          .run();

        focusNextNode(props.editor);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
      extension.options.onError?.(new Error("No file selected"));
      return;
    }
    handleUpload(Array.from(files));
  };

  const handleClick = () => {
    if (inputRef.current && fileItems.length === 0) {
      inputRef.current.value = "";
      inputRef.current.click();
    }
  };

  const hasFiles = fileItems.length > 0;

  return (
    <NodeViewWrapper
      className="tiptap-image-upload"
      tabIndex={0}
      onClick={handleClick}
    >
      {!hasFiles && (
        <ImageUploadDragArea onFile={handleUpload} accept={accept}>
          <DropZoneContent maxSize={maxSize} limit={limit} />
        </ImageUploadDragArea>
      )}

      {hasFiles && (
        <div className="tiptap-image-upload-previews">
          {fileItems.length > 1 && (
            <div className="tiptap-image-upload-header">
              <span>Uploading {fileItems.length} files</span>
              <Button
                type="button"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  clearAllFiles();
                }}
              >
                Clear All
              </Button>
            </div>
          )}
          {fileItems.map((fileItem) => (
            <ImageUploadPreview
              key={fileItem.id}
              fileItem={fileItem}
              onRemove={() => removeFileItem(fileItem.id)}
            />
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        name="file"
        accept={accept}
        type="file"
        multiple={limit > 1}
        onChange={handleChange}
        onClick={(e: React.MouseEvent<HTMLInputElement>) => e.stopPropagation()}
      />
    </NodeViewWrapper>
  );
};
