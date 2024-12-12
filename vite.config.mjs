import { viteStaticCopy } from 'vite-plugin-static-copy';
import { createHtmlPlugin } from 'vite-plugin-html'
import * as stlitePackage from './node_modules/@stlite/mountable/package.json';

const stlitePath = `lib/stlite@${stlitePackage.version}`;

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
    createHtmlPlugin({ inject: { data: { stlitePath } } })
  ],
};
