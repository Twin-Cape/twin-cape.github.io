declare module 'csso' {
  interface MinifyResult {
    css: string;
    map?: object;
  }

  interface MinifyOptions {
    sourceMap?: boolean;
    filename?: string;
    debug?: boolean;
    usage?: object | null;
    restructure?: boolean;
    forceMediaMerge?: boolean;
  }

  function minify(css: string, options?: MinifyOptions): MinifyResult;
}
