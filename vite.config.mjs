import { viteStaticCopy } from 'vite-plugin-static-copy';

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
          dest: 'public/stlite',
        },
      ],
    }),
  ],
};
