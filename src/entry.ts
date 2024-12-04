declare global {
  const stlite: any;

  interface Window {
    app: any;
  }
}

// Page is loaded directly
if (window === window.parent) window.location.href = 'https://ibm.com';

const ALLOWED_ORIGINS = (import.meta.env.VITE_ALLOWED_FRAME_ANCESTORS ?? '').split(' ').filter(Boolean);

(() => {
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
      case 'setFullscreen':
        classList.toggle('fullscreen', data.value);

        return;
      case 'updateTheme':
        classList.remove(data.theme === 'light' ? 'cds--g90' : 'cds--white');
        classList.add(data.theme === 'light' ? 'cds--white' : 'cds--g90');

        return;
      case 'updateCode':
        await window.app.writeFile('app.py', data.code);
        await window.app.writeFile('trigger.py', 'import run; await run.run(); # ' + Math.random());

        return;
      case 'reportError':
        ALLOWED_ORIGINS.forEach((origin: string) =>
          parent.postMessage({ type: 'reportError', errorText: data?.errorText }, origin),
        );
        return;
      default:
        return;
    }
  });

  window.app = stlite.mount(
    {
      requirements: ['requests'],
      entrypoint: 'trigger.py',
      files: {
        'trigger.py': 'import run; await run.run()',
        'app.py': '',
        // NOTE: in production, we probably want to inline these two
        'run.py': { url: 'python/run.py' },
        'util.py': { url: 'python/util.py' },
      },
      streamlitConfig: {
        'client.toolbarMode': 'minimal',
        'server.runOnSave': true,
        'theme.primaryColor': '#0f62fe',
      },
    },
    document.getElementById('root'),
  );
})();
