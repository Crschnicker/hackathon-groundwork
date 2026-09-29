// Makes a photo small enough to send before it leaves the browser: a phone photo can be 5 to 10 MB,
// and 2048 px on the long side is plenty for a proposal. Redrawing it also drops the file's
// metadata (GPS position included), which the client never needs to see.

const MAX_SIDE = 2048;
const QUALITY = 0.85;
const SENDABLE = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export class UnsupportedPhotoError extends Error {
  constructor() {
    super("This file cannot be added. Use a JPEG, PNG or WebP photo.");
  }
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
}

async function redraw(file: Blob): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function") return null;
  // "from-image" turns a phone photo upright by its orientation tag before drawing it.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    // A transparent PNG would turn black as a JPEG; give it the page's white instead.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvasBlob(canvas);
  } finally {
    bitmap.close();
  }
}

/**
 * The photo as a JPEG at most 2048 px on its long side. When the browser cannot redraw it, a
 * JPEG, PNG or WebP goes as it is; anything else is refused with UnsupportedPhotoError.
 */
export async function downscalePhoto(file: File): Promise<Blob> {
  try {
    const small = await redraw(file);
    if (small && small.size > 0) return small;
  } catch {
    // Not an image this browser can decode (a HEIC on a desktop browser, say); fall through.
  }
  if (SENDABLE.has(file.type.toLowerCase())) return file;
  throw new UnsupportedPhotoError();
}
