import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

const replacement = String.raw`
(async () => {
  const legacySuffix = '/pwa/service-worker.js';
  const rootScript = '/service-worker.js';

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const legacyRegistration = registrations.find(reg => {
      const urls = [
        reg.active?.scriptURL || '',
        reg.waiting?.scriptURL || '',
        reg.installing?.scriptURL || ''
      ];
      return urls.some(url => url.endsWith(legacySuffix));
    });

    if (legacyRegistration) {
      console.log('[pwa] Oude service worker gevonden; migreren naar root-service-worker.');
      await legacyRegistration.unregister();
      await navigator.serviceWorker.register(rootScript, {scope:'/'});

      if (!sessionStorage.getItem('security-pwa-sw-migrated')) {
        sessionStorage.setItem('security-pwa-sw-migrated', '1');
        location.reload();
        return;
      }
    } else {
      await navigator.serviceWorker.register(rootScript, {scope:'/'});
      sessionStorage.removeItem('security-pwa-sw-migrated');
    }
  } catch (error) {
    console.warn('[pwa] Service worker migratie/registratie mislukt:', error.message);
  }
})()
`;

fs.readFileSync = function pwaRootRegisterReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');
  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  text = text.replace(
    "navigator.serviceWorker.register('/pwa/service-worker.js',{scope:'/'})",
    replacement
  );

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
