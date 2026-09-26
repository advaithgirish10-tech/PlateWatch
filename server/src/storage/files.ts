import sharp from "sharp";

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;
export const PDF = "application/pdf";
export type AllowedType = (typeof IMAGE_TYPES)[number] | (typeof VIDEO_TYPES)[number] | typeof PDF;

export const EXT: Record<AllowedType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "application/pdf": "pdf",
};

export const MAX_BYTES = { image: 10 * 1024 * 1024, pdf: 10 * 1024 * 1024, video: 50 * 1024 * 1024 };
export const maxBytesFor = (t: AllowedType) => (t.startsWith("video/") ? MAX_BYTES.video : t === PDF ? MAX_BYTES.pdf : MAX_BYTES.image);
export const isImage = (t: string): t is (typeof IMAGE_TYPES)[number] => (IMAGE_TYPES as readonly string[]).includes(t);

/* the real type from the file's first bytes; the browser's declared type can't be trusted */
export function sniff(b: Buffer): AllowedType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (b.length >= 5 && b.toString("latin1", 0, 5) === "%PDF-") return PDF;
  if (b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp") {
    const brand = b.toString("latin1", 8, 12);
    if (brand === "qt  ") return "video/quicktime";
    if (/^(isom|iso2|mp41|mp42|avc1|M4V |dash)$/.test(brand)) return "video/mp4";
  }
  return null;
}

/* re-encode an image: applies EXIF rotation, then drops all metadata (GPS location, camera, owner) */
export async function sanitizeImage(body: Buffer, type: (typeof IMAGE_TYPES)[number]): Promise<Buffer> {
  const img = sharp(body, { failOn: "error" }).rotate();
  if (type === "image/png") return img.png().toBuffer();
  if (type === "image/webp") return img.webp({ quality: 85 }).toBuffer();
  return img.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
}
