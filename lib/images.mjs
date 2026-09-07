import { formatMessage as tr } from '../public/i18n-core.js';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGES_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_REQUEST_BYTES = 40 * 1024 * 1024;
export const MAX_IMAGES = 4;
const formats = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
export const imageMessageText = (text) => {
  const clean = text.replace(
    /<file name="[^"\n]*[\\/]\.studio-images[\\/][a-f0-9]{64}\.(?:png|jpg|gif|webp)">[^<]*<\/file>\n?/g,
    '',
  );
  return clean === text ? text : clean.trim();
};
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
function matches(bytes, mime) {
  if (mime === 'image/png')
    return (
      bytes.length >= 24 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.toString('ascii', 12, 16) === 'IHDR'
    );
  if (mime === 'image/jpeg')
    return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/gif')
    return bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
  return (
    bytes.length >= 16 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  );
}
export function validateImages(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_IMAGES) fail(tr('server.ajoutez_au_maximum_4_images'));
  let total = 0;
  return value.map((image) => {
    if (
      !image ||
      image.type !== 'image' ||
      !Object.hasOwn(formats, image.mimeType) ||
      typeof image.data !== 'string'
    )
      fail(tr('server.formats_acceptes_png_jpeg_gif_et_webp'));
    if (!image.data.length || image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
      fail(tr('server.une_image_depasse_4_mo'), 413);
    if (image.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data))
      fail(tr('server.image_encodee_incorrectement'));
    const bytes = Buffer.from(image.data, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES || (total += bytes.length) > MAX_IMAGES_BYTES)
      fail(tr('server.limite_4_mo_par_image_et_8_mo_par_message'), 413);
    if (bytes.toString('base64') !== image.data || !matches(bytes, image.mimeType))
      fail(tr('server.le_contenu_ne_correspond_pas_au_format_de_l_image'));
    return { type: 'image', mimeType: image.mimeType, data: image.data };
  });
}
export function imageAttachments(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((item) => item?.type === 'image')
    .map((item) => {
      try {
        return validateImages([item])[0];
      } catch {
        return { type: 'image', mimeType: String(item.mimeType || '') };
      }
    });
}
export function imageBodyLimit(path) {
  return path === '/api/runs' || /^\/api\/live\/sessions\/[A-Za-z0-9_-]+\/messages$/.test(path)
    ? MAX_IMAGE_REQUEST_BYTES
    : 512 * 1024;
}
export async function persistImages(images, directory) {
  if (!images.length) return [];
  await mkdir(directory, { recursive: true });
  const paths = [];
  for (const image of images) {
    const bytes = Buffer.from(image.data, 'base64');
    const file = join(
      directory,
      `${createHash('sha256').update(bytes).digest('hex')}.${formats[image.mimeType]}`,
    );
    await writeFile(file, bytes, { flag: 'wx', mode: 0o600 }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    paths.push(file);
  }
  return paths;
}
