import "server-only";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Stockage objet S3 compatible (Scaleway, OVHcloud, Cloudflare R2, AWS…) pour les pièces des dossiers.
 * Variables : S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE (1 pour MinIO / tests).
 * Le compartiment reste privé : les fichiers ne sont servis que par KolBase, après contrôle des droits.
 */
const config = () => {
  const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  return S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
    ? { bucket: S3_BUCKET, endpoint: S3_ENDPOINT || undefined, region: S3_REGION || "fr-par", key: S3_ACCESS_KEY_ID, secret: S3_SECRET_ACCESS_KEY }
    : null;
};

export const storageEnabled = () => config() !== null;

const g = globalThis as unknown as { kbS3?: S3Client };
function client() {
  const c = config();
  if (!c) throw new Error("Stockage non configuré (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).");
  g.kbS3 ??= new S3Client({
    region: c.region,
    endpoint: c.endpoint,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1",
    credentials: { accessKeyId: c.key, secretAccessKey: c.secret },
    // Les fournisseurs S3 compatibles ne gèrent pas tous les sommes de contrôle récentes d'AWS.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return { s3: g.kbS3, bucket: c.bucket };
}

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  const { s3, bucket } = client();
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.byteLength }));
}

/** Contenu d'un objet (les pièces sont limitées à quelques mégaoctets). */
export async function getObject(key: string): Promise<Uint8Array> {
  const { s3, bucket } = client();
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error("Objet vide");
  return res.Body.transformToByteArray();
}

export async function deleteObject(key: string) {
  const { s3, bucket } = client();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Fichiers acceptés : PDF, images, documents bureautiques courants. */
export const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPEG",
  "image/png": "PNG",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
};
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Nom de fichier sûr pour la clé de stockage et l'en-tête de téléchargement. */
export const safeFileName = (name: string) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "document";
