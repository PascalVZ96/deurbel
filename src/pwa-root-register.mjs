import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

fs.readFileSync = function pwaRootRegisterReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');
  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  text = text.replace(
    "navigator.serviceWorker.register('/pwa/service-worker.js',{scope:'/'})",
    "navigator.serviceWorker.register('/service-worker.js',{scope:'/'})"
  );

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
