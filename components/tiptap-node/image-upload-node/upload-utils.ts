export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Handles image upload with progress tracking and abort capability
 * @param file The file to upload
 * @param onProgress Optional callback for tracking upload progress
 * @param abortSignal Optional AbortSignal for cancelling the upload
 * @returns Promise resolving to the URL of the uploaded image
 */
export const handleImageUpload = async (
  file: File,
  onProgress?: (event: { progress: number }) => void,
  abortSignal?: AbortSignal,
): Promise<string> => {
  if (!file) {
    throw new Error("No file provided");
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File size exceeds maximum allowed (${MAX_FILE_SIZE / (1024 * 1024)}MB)`,
    );
  }

  return new Promise((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(new Error("Upload cancelled"));
      return;
    }

    const reader = new FileReader();

    reader.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress?.({ progress: Math.round((e.loaded / e.total) * 100) });
      }
    };

    reader.onload = () => {
      onProgress?.({ progress: 100 });
      resolve(reader.result as string);
    };

    reader.onerror = () => reject(new Error("Failed to read file"));

    abortSignal?.addEventListener(
      "abort",
      () => {
        reader.abort();
        reject(new Error("Upload cancelled"));
      },
      { once: true },
    );

    reader.readAsDataURL(file);
  });
};
