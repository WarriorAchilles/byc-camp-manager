export const CAMPER_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export const CAMPER_PHOTO_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type CamperPhotoContentType = typeof CAMPER_PHOTO_CONTENT_TYPES[number];

export function isCamperPhotoContentType(value: string): value is CamperPhotoContentType {
  return CAMPER_PHOTO_CONTENT_TYPES.includes(value as CamperPhotoContentType);
}

export function hasExpectedImageSignature(
  data: Uint8Array,
  contentType: CamperPhotoContentType,
): boolean {
  if (contentType === "image/jpeg") {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (contentType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return data.length >= signature.length
      && signature.every((byte, index) => data[index] === byte);
  }
  return data.length >= 12
    && String.fromCharCode(...data.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...data.slice(8, 12)) === "WEBP";
}
