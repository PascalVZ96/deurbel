import fs from 'node:fs';

const previousReadFileSync = fs.readFileSync.bind(fs);

const frigateRouteInjection = String.raw`
<script id="frigate-secure-route-script">
(() => {
  function securedFrigateUrl(value){
    if(!value) return value;
    try{
      const url = new URL(String(value), location.href);
      if(url.port !== '8971') return value;
      return '/frigate' + url.pathname + url.search + url.hash;
    }catch{
      return value;
    }
  }

  function rewriteFrigateLinks(root=document){
    root.querySelectorAll?.('a[href]').forEach(link => {
      const secured = securedFrigateUrl(link.href);
      if(secured !== link.href) link.setAttribute('href', secured);
    });
  }

  const originalOpen = window.open.bind(window);
  window.open = function(url, ...args){
    return originalOpen(securedFrigateUrl(url), ...args);
  };

  rewriteFrigateLinks();

  const observer = new MutationObserver(mutations => {
    for(const mutation of mutations){
      if(mutation.type === 'attributes' && mutation.target instanceof HTMLAnchorElement){
        const link = mutation.target;
        const secured = securedFrigateUrl(link.href);
        if(secured !== link.href) link.setAttribute('href', secured);
      }
      for(const node of mutation.addedNodes || []){
        if(node.nodeType === 1) rewriteFrigateLinks(node);
      }
    }
  });

  observer.observe(document.documentElement, {
    subtree:true,
    childList:true,
    attributes:true,
    attributeFilter:['href']
  });
})();
</script>
`;

fs.readFileSync = function frigateRouteReadFileSync(file, options) {
  const data = previousReadFileSync(file, options);
  const normalized = String(file).replaceAll('\\', '/');

  if (!normalized.endsWith('/public/security.html')) return data;

  const encoding = typeof options === 'string' ? options : options?.encoding;
  const returnBuffer = !encoding && Buffer.isBuffer(data);
  let text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);

  if (!text.includes('id="frigate-secure-route-script"')) {
    text = text.replace('</body>', frigateRouteInjection + '\n</body>');
  }

  return returnBuffer ? Buffer.from(text, 'utf8') : text;
};
