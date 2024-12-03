declare global {
  const stlite: any;

  interface Window {
    app: any;
  }
}

// Page is loaded directly
if (window === window.parent) window.location.href = 'https://ibm.com';

(() => {
  window.addEventListener('message', async (event) => {
    const { data } = event;

    if (!data && !data.type) {
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
        await window.app.writeFile(
          'trigger.py',
          'import run; await run.run(); # ' + Math.random()
        );

        return;
      case 'reportError':
        parent.postMessage(
          {
            type: 'reportError',
            errorText: data?.errorText,
          },
          '*'
        ); // IMPORTANT: put actual origin here in production

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
    document.getElementById('root')
  );
})();
