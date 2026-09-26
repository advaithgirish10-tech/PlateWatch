/*
 * Automatic face blurring. Every uploaded photo is checked for faces, and each face is pixelated before the photo is
 * stored, so the original never stays on the server. Detection is SSD MobileNet v1 (face-api) on TensorFlow's
 * WebAssembly backend: no native build, about 0.3 s a photo. Small, far-away or side-on faces can be missed, so
 * reviewers still check photos before they're public.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import sharp from "sharp";

export interface Box { x: number; y: number; width: number; height: number }

export interface FaceDetector {
  /* faces in the image, in its pixel coordinates (after EXIF rotation) */
  detect(image: Buffer): Promise<Box[]>;
}

/* detection runs on a copy at most this wide; SSD itself looks at 512×512 */
const DETECT_MAX = 1024;
const MIN_CONFIDENCE = 0.3;

export function ssdFaceDetector(): FaceDetector {
  type FaceApi = typeof import("@vladmandic/face-api");
  let ready: Promise<FaceApi> | null = null;
  const load = () =>
    (ready ??= (async () => {
      const faceapi = (await import("@vladmandic/face-api/dist/face-api.node-wasm.js")) as unknown as FaceApi;
      /* face-api's typings leave out tfjs's backend controls */
      const tf = faceapi.tf as unknown as { setBackend(name: string): Promise<boolean>; ready(): Promise<void> };
      await tf.setBackend("wasm");
      await tf.ready();
      const model = join(dirname(createRequire(import.meta.url).resolve("@vladmandic/face-api/package.json")), "model");
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(model);
      return faceapi;
    })().catch((err) => {
      ready = null;
      throw err;
    }));
  /* one detection at a time: the model isn't built for parallel calls, and it keeps memory flat */
  let queue: Promise<unknown> = Promise.resolve();
  return {
    detect(image) {
      const run = async () => {
        const faceapi = await load();
        const meta = await sharp(image).rotate().metadata();
        const W = meta.autoOrient?.width ?? meta.width!, H = meta.autoOrient?.height ?? meta.height!;
        const scale = Math.min(1, DETECT_MAX / Math.max(W, H));
        const w = Math.round(W * scale), h = Math.round(H * scale);
        const { data } = await sharp(image).rotate().resize(w, h).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const tensor = faceapi.tf.tensor3d(new Uint8Array(data), [h, w, 3]);
        try {
          const found = await faceapi.detectAllFaces(tensor as never, new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_CONFIDENCE, maxResults: 100 }));
          return found.map((d) => ({ x: d.box.x / scale, y: d.box.y / scale, width: d.box.width / scale, height: d.box.height / scale }));
        } finally {
          tensor.dispose();
        }
      };
      const p = queue.then(run, run);
      queue = p.catch(() => undefined);
      return p;
    },
  };
}

/* tests, and deployments that switch detection off */
export const noFaceDetector: FaceDetector = { detect: async () => [] };

/* pixelate each face, with a margin for hair and ears, then soften the blocks so nothing can be read back */
export async function blurFaces(image: Buffer, boxes: Box[], type: string): Promise<Buffer> {
  if (!boxes.length) return image;
  const meta = await sharp(image).metadata();
  const W = meta.width!, H = meta.height!;
  const patches = await Promise.all(
    boxes.map(async (b) => {
      const mx = b.width * 0.3, my = b.height * 0.35;
      const left = Math.max(0, Math.floor(b.x - mx)), top = Math.max(0, Math.floor(b.y - my));
      const width = Math.min(W - left, Math.ceil(b.width + 2 * mx)), height = Math.min(H - top, Math.ceil(b.height + 2 * my));
      if (width < 2 || height < 2) return null;
      /* about 5 blocks across a face: too coarse to recognise anyone, even to a face detector */
      const bx = 5, by = Math.max(2, Math.round((bx * height) / width));
      const small = await sharp(image).extract({ left, top, width, height }).resize(bx, by, { fit: "fill", kernel: "cubic" }).toBuffer();
      const input = await sharp(small).resize(width, height, { fit: "fill", kernel: "nearest" }).blur(Math.max(3, width / 12)).toBuffer();
      return { input, left, top };
    }),
  );
  const img = sharp(image).composite(patches.filter((p): p is NonNullable<typeof p> => !!p));
  if (type === "image/png") return img.png().toBuffer();
  if (type === "image/webp") return img.webp({ quality: 85 }).toBuffer();
  return img.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
}

/*
 * A 64-bit difference hash: survives re-encoding, resizing and small edits, so a reused photo still matches.
 * Null for a nearly featureless photo (a blank wall, a black frame): every one of those would look alike.
 */
export async function dhash(image: Buffer): Promise<bigint | null> {
  const { channels } = await sharp(image).grayscale().stats();
  if (channels[0]!.stdev < 6) return null;
  const px = await sharp(image).rotate().grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let h = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h = (h << 1n) | (px[y * 9 + x]! < px[y * 9 + x + 1]! ? 1n : 0n);
  /* Postgres bigint is signed */
  return BigInt.asIntN(64, h);
}
