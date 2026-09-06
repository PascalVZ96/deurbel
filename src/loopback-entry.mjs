import http from 'node:http';

const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  if (typeof args[0] === 'object' && args[0] !== null) {
    args[0] = { ...args[0], host: '127.0.0.1' };
  } else if (typeof args[0] === 'number') {
    if (typeof args[1] === 'string') args[1] = '127.0.0.1';
    else args.splice(1, 0, '127.0.0.1');
  }
  return originalListen.apply(this, args);
};

const target = process.argv[2];
if (!target || !/^\.\/[A-Za-z0-9._/-]+\.mjs$/.test(target)) {
  throw new Error('Gebruik: node src/loopback-entry.mjs ./module.mjs');
}

await import(new URL(target, import.meta.url));