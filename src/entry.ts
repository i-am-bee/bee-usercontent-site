import runPy from './python/run.py?raw';

declare global {
  const stlite: any;
}

// Page is loaded directly
if (window === window.parent) window.location.href = 'https://ibm.com';

const ALLOWED_ORIGINS = (import.meta.env.VITE_ALLOWED_FRAME_ANCESTORS ?? '').split(' ').filter(Boolean);

(() => {
  const app = stlite.mount(
    {
      requirements: ['requests', 'pydantic'],
      entrypoint: 'trigger.py',
      files: {
        'trigger.py': 'import run; await run.run()',
        'app.py': 'async def main():\n  pass',
        'config.json': '{}',
        'run.py': runPy,
      },
      streamlitConfig: {
        'client.toolbarMode': 'minimal',
        'server.runOnSave': true,
        'theme.primaryColor': '#0f62fe',
      },
    },
    document.getElementById('root'),
  );

  window.addEventListener('message', async (event) => {
    const { data, origin } = event;

    if (
      (!data && !data.type) ||
      // allow self origin messages from python app
      ![...ALLOWED_ORIGINS, window.location.origin].includes(origin)
    ) {
      return;
    }

    const { classList } = document.body;

    switch (data.type) {
      case 'bee:setFullscreen':
        classList.toggle('fullscreen', data.value);

        return;
      case 'bee:updateTheme':
        classList.remove(data.theme === 'light' ? 'cds--g90' : 'cds--white');
        classList.add(data.theme === 'light' ? 'cds--white' : 'cds--g90');

        return;
      case 'bee:updateCode':
        await app.writeFile('app.py', data.code);
        await app.writeFile('config.json', JSON.stringify(data.config ?? {}));
        await app.writeFile('trigger.py', 'import run; await run.run(); # ' + Math.random());

        return;
      case 'bee:response':
        app.kernel._worker.postMessage(data);
        return;
      default:
        return;
    }
  });

  app.kernel._worker.addEventListener('message', (event: MessageEvent) => {
    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    switch (data.type) {
      case 'bee:reportError':
        ALLOWED_ORIGINS.forEach((origin: string) =>
          parent.postMessage({ type: data.type, errorText: data?.errorText }, origin),
        );
        return;
      case 'bee:request':
        ALLOWED_ORIGINS.forEach((origin: string) => parent.postMessage(data, origin));
        return;
      default:
        return;
    }
  });
})();
