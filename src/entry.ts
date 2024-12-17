import runPy from './python/run.py?raw';

declare global {
  const stlite: any;
}

// Page is loaded directly
if (!import.meta.env.VITE_DEBUG && window === window.parent) window.location.href = 'https://iambee.ai/';

const ALLOWED_ORIGINS = (import.meta.env.VITE_ALLOWED_FRAME_ANCESTORS ?? '').split(' ').filter(Boolean);

(() => {
  let state = { code: 'async def main():\n  pass', config: {} };
  let currentTheme = 'light';
  let app: any;

  function mountApp(theme: 'light' | 'dark' = 'light') {
    app = stlite.mount(
      {
        requirements: ['pydantic'],
        entrypoint: 'trigger.py',
        files: {
          'trigger.py': 'import run; await run.run()',
          'app.py': import.meta.env.VITE_DEBUG
            ? 'import streamlit as st\nasync def main():\n  st.write("APP LOADED!")'
            : state.code,
          'config.json': JSON.stringify(state.config),
          'run.py': runPy,
        },
        streamlitConfig: {
          'client.toolbarMode': 'minimal',
          'server.runOnSave': true,
          'theme.primaryColor': '#0f62fe',
          ...(theme === 'light' ? {
            'theme.base': 'light',
            'theme.backgroundColor': '#ffffff',
            'theme.secondaryBackgroundColor': '#ffffff',
          } : {
            'theme.base': 'dark',
            'theme.backgroundColor': '#21272a',
            'theme.secondaryBackgroundColor': '#21272a',
          })
        },
      },
      document.getElementById('root'),
    );

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
  }

  mountApp();

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
        if(data.theme !== currentTheme) {
          currentTheme = data.theme;
          app?.unmount();
          mountApp(data.theme);
        }

        return;
      case 'bee:updateCode':
        const newState = { code: data.code, config: data.config }
        if (JSON.stringify(state) === JSON.stringify(newState)) return;
        await app.writeFile('app.py', data.code);
        await app.writeFile('config.json', JSON.stringify(data.config ?? {}));
        await app.writeFile('trigger.py', 'import run; await run.run(); # ' + Math.random());
        state = newState;

        return;
      case 'bee:response':
        app.kernel._worker.postMessage(data);
        return;
      default:
        return;
    }
  });
})();
