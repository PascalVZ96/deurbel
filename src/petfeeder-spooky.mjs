const originalFetch = globalThis.fetch.bind(globalThis);

const spookyName = String(process.env.PETFEEDER_CAT_NAME || 'Spooky').trim() || 'Spooky';
const spookyDescription = String(
  process.env.PETFEEDER_CAT_DESCRIPTION || 'zwart-witte kater'
).trim() || 'zwart-witte kater';

function petFeederIdentityInstruction() {
  return `\n\nBekende kat bij deze Pet Feeder-camera:\n- De ${spookyDescription} heet ${spookyName}.\n- ${spookyName} is een kater; gebruik dus mannelijke verwijzingen wanneer je hem bij naam noemt.\n- Gebruik de naam ${spookyName} alleen wanneer op meerdere beelden duidelijk dezelfde ${spookyDescription} zichtbaar is.\n- Als kleur/patroon of identiteit niet duidelijk genoeg zichtbaar is, schrijf dan gewoon \"de kat\" en gok niet.\n- Doe nog steeds geen aannames over honger, emoties of intenties.`;
}

globalThis.fetch = async function spookyAwareFetch(input, init = {}) {
  const url = typeof input === 'string'
    ? input
    : String(input?.url || input || '');

  if (
    url.includes('generativelanguage.googleapis.com') &&
    typeof init?.body === 'string'
  ) {
    try {
      const payload = JSON.parse(init.body);
      const parts = payload?.contents?.[0]?.parts;

      if (Array.isArray(parts)) {
        const promptPart = parts.find(
          part => typeof part?.text === 'string' &&
            part.text.includes('automatische kattenvoerbak')
        );

        if (promptPart && !promptPart.text.includes(`heet ${spookyName}`)) {
          promptPart.text += petFeederIdentityInstruction();
          init = {
            ...init,
            body: JSON.stringify(payload),
          };
        }
      }
    } catch (error) {
      console.warn(`[petfeeder-ai] Spooky-identiteitscontext kon niet worden toegevoegd: ${error.message}`);
    }
  }

  return originalFetch(input, init);
};

console.log(
  `[petfeeder-ai] Bekende kat actief: ${spookyName} · ${spookyDescription}`
);

await import('./frigate-genai-fallback.mjs');
