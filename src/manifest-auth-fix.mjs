import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

fs.readFileSync = function manifestAuthReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');
  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  text = text.replace(
    '<link rel="manifest" href="/pwa/manifest.webmanifest">',
    '<link rel="manifest" href="/pwa/manifest.webmanifest" crossorigin="use-credentials">'
  );

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
