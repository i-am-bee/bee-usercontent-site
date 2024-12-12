import { glob } from 'glob'
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { createHtmlPlugin } from 'vite-plugin-html'
import * as stlitePackage from './node_modules/@stlite/mountable/package.json';
import * as preload from './preload.json';

const stlitePath = `lib/stlite@${stlitePackage.version}`;
const preloadItems = [
  ...preload.items,
  ...(await glob("./node_modules/@stlite/mountable/build/pypi/*.whl", { withFileTypes: true })).map(path => ({url: `/${stlitePath}/pypi/${path.name}`, contentType: 'application/wasm'})),
  ...(await glob("./node_modules/@stlite/mountable/build/*.module.wasm", { withFileTypes: true })).map(path => ({url: `/${stlitePath}/${path.name}`, contentType: 'application/wasm'}))
]

export default {
  css: {
    preprocessorOptions: {
      scss: {
        quietDeps: true,
        silenceDeprecations: ['mixed-decls'],
      },
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@stlite/mountable/build/*',
          dest: stlitePath,
        },
      ],
    }),
    createHtmlPlugin({ inject: { data: { stlitePath, preloadItems } } })
  ],
};
