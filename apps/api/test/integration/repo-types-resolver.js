// apps/api/test/integration/repo-types-resolver.js
//
// Custom Jest resolver (integration config only — see jest.integration.config.js)
// that strips a trailing `.js` extension ONLY for relative specifiers resolved FROM
// WITHIN packages/types/src (its NodeNext moduleResolution config makes its own source
// import sibling files as `./common/envelope.js` even though only `.ts` files exist on
// disk; ts-jest needs the `.ts` path to compile them).
//
// A plain `moduleNameMapper` regex (`^(\.{1,2}/.*)\.js$` => `$1`) is NOT safe here: Jest
// applies moduleNameMapper to every relative specifier project-wide, with no awareness of
// which file is doing the importing — it ALSO matched third-party ESM packages' own
// internal barrel re-exports (e.g. jose's `dist/webapi/index.js` does
// `export { SignJWT } from './jwt/sign.js'`), silently breaking their real resolution and
// making jose's real module exports look exactly like test/__mocks__/jose.ts's stub
// (literal "stub.jwt.token" strings, `{}` JWT payloads) with NO explicit jose mock in
// this config. A custom resolver lets us inspect `options.basedir` (the importing file's
// directory) and only intervene for imports originating inside packages/types/src.
const path = require("node:path");

const TYPES_SRC = path.normalize(path.join(__dirname, "..", "..", "..", "..", "packages", "types", "src"));

module.exports = (request, options) => {
  const isRelativeJs = /^\.{1,2}\/.*\.js$/.test(request);
  const importedFromTypesSrc = options.basedir && path.normalize(options.basedir).startsWith(TYPES_SRC);

  if (isRelativeJs && importedFromTypesSrc) {
    const stripped = request.slice(0, -3);
    return options.defaultResolver(stripped, options);
  }

  return options.defaultResolver(request, options);
};
