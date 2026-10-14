// The Hey API configuration of the generated client. `generate.mjs` and
// `contract-check.mjs` use the same configuration, so the check compares
// the output of the same generator settings.
//
// - `@hey-api/client-fetch`: the fetch client. The generator copies its
//   runtime into the output, so the package needs no client runtime package.
// - `@hey-api/typescript`: the wire types.
// - `zod`: the Zod 4 validators of every schema and response.
// - `@hey-api/sdk` with `validator.response`: each SDK function validates
//   its success body with the generated Zod schema before it returns.
//   Requests are not validated: the facade builds them from typed values.
//
// The output must not depend on where it is written. The generator would
// otherwise read the first `tsconfig*.json` above its own install directory
// to choose the import extension, so the configuration fixes the extension
// and turns the lookup off.
export const generatorConfig = ({ input, output }) => ({
  input,
  output: {
    path: output,
    clean: true,
    module: { extension: '.js' },
    tsConfigPath: null,
  },
  plugins: [
    '@hey-api/client-fetch',
    '@hey-api/typescript',
    'zod',
    {
      name: '@hey-api/sdk',
      validator: {
        request: false,
        response: 'zod',
      },
    },
  ],
})
