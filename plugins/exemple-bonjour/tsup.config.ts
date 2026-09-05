import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/client.ts'],
  format: ['esm'],
  // Le SDK est embarque plutot que reference : le bundle doit etre chargeable
  // par un `import()` depuis n'importe ou, sans resolution de dependances.
  noExternal: [/@tick\/plugin-sdk/],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'es2023',
});
