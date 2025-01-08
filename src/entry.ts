import runPy from './python/run.py?raw';

declare global {
  const stlite: any;
}

interface AppState {
  fullscreen: boolean,
  theme: 'light' | 'dark' | 'system',
  code: string,
  config: {
    canFixError: boolean
  },
  ancestorOrigin: string,
}

// Page is loaded directly
if (!import.meta.env.VITE_DEBUG && window === window.parent) window.location.href = 'https://iambee.ai/';

const ALLOWED_ORIGINS = (import.meta.env.VITE_ALLOWED_FRAME_ANCESTORS ?? '').split(' ').filter(Boolean);

(() => {
  let state: AppState = {
    code: import.meta.env.VITE_DEBUG ? 'import streamlit as st\nasync def main():\n  st.write("APP LOADED!")': 'async def main():\n  pass',
    config: {
      canFixError: false
    },
    theme: 'light',
    fullscreen: false,
    ancestorOrigin: ALLOWED_ORIGINS[0],
  };

  let app: any;

  async function updateState(stateChange: Partial<AppState>) {
    const oldState = { ...state };

    // validate ancestorOrigin
    if(!ALLOWED_ORIGINS.includes(stateChange.ancestorOrigin)) stateChange.ancestorOrigin = undefined;

    // update state
    state = { ...state, ...stateChange };

    // set fullscreen
    document.body.classList.toggle('fullscreen', state.fullscreen);

    // change theme
    if(oldState.theme !== state.theme) {
      document.body.classList.toggle('cds--g90', state.theme === 'dark');
      document.body.classList.toggle('cds--white', state.theme === 'light');
      app?.unmount();
      mountApp();
    }

    // update code & config
    if (oldState.code !== state.code || JSON.stringify(oldState.config) !== JSON.stringify(state.config)) {
      await app.writeFile('app.py', state.code);
      await app.writeFile('config.json', JSON.stringify(state.config));
      await app.writeFile('trigger.py', 'import run; await run.run(); # ' + Math.random());
    }
  }

  function mountApp() {
    app = stlite.mount(
      {
        requirements: ['pydantic'],
        entrypoint: 'trigger.py',
        files: {
          'trigger.py': 'import run; await run.run()',
          'app.py': state.code,
          'config.json': JSON.stringify(state.config),
          'run.py': runPy,
        },
        streamlitConfig: {
          'client.toolbarMode': 'minimal',
          'server.runOnSave': true,
          'theme.primaryColor': '#0f62fe',
          ...(state.theme === 'light' ? {
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
        case 'bee:ready':
          parent.postMessage({ type: 'bee:ready' }, state.ancestorOrigin);
          return;

        case 'bee:request':
          parent.postMessage(data, state.ancestorOrigin);
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

    switch (data.type) {
      case 'bee:response':
        app.kernel._worker.postMessage(data);
        return;

      case 'bee:updateState':
        updateState(data.stateChange);
        return;

      default:
        return;
    }
  });
})();
