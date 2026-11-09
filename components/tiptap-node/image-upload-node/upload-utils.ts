import { prepareImageForEmbed } from "@/lib/image-downscale";

/** Max size of a picked/pasted file before it is downscaled for embedding. */
export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/** Max images accepted per upload or paste gesture. */
export const IMAGE_UPLOAD_LIMIT = 3;

/**
 * Converts an image file into an embeddable data URL. Raster images are
 * downscaled and re-encoded until they fit `MAX_EMBED_IMAGE_BYTES`, so one
 * photo cannot push the shared document past the server's size cap.
 * @param file The file to upload
 * @param onProgress Optional callback for tracking upload progress
 * @param abortSignal Optional AbortSignal for cancelling the upload
 * @returns Promise resolving to the data URL of the image
 * @throws Error with a user-facing message when the image can't be embedded
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

  const src = await prepareImageForEmbed(file, {
    signal: abortSignal,
    onProgress: (progress) => onProgress?.({ progress }),
  });
  onProgress?.({ progress: 100 });
  return src;
};
