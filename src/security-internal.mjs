import http from 'node:http';

const originalListen = http.Server.prototype.listen;

http.Server.prototype.listen = function patchedListen(...args) {
  if (typeof args[0] === 'number') {
    if (typeof args[1] === 'string') args[1] = '127.0.0.1';
    else args.splice(1, 0, '127.0.0.1');
  }
  return originalListen.apply(this, args);
};

await import('./security-monitor.mjs');
