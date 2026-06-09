import { txlRuntimePackager } from "./TXLRuntimePackager.mjs";

export class RuntimeBundleGenerator {
  generate(files) {
    return txlRuntimePackager.package(files);
  }
}

export const runtimeBundleGenerator = new RuntimeBundleGenerator();
