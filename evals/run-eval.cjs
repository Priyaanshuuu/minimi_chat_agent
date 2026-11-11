/* eslint-disable @typescript-eslint/no-require-imports */
const Module = require("node:module");
const path = require("node:path");

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    request = path.join(process.cwd(), ".eval-build", request.slice(2));
  }

  return originalResolveFilename.call(this, request, parent, isMain, options);
};

require("../.eval-build/evals/runner.js").runEvaluations();
