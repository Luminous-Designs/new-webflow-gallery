declare module "unzipper" {
  export type ZipEntry = {
    path: string;
    type: string;
    stream(): NodeJS.ReadableStream;
    buffer(): Promise<Buffer>;
  };

  export type ZipDirectory = {
    files: ZipEntry[];
  };

  export const Open: {
    file(path: string, options?: unknown): Promise<ZipDirectory>;
    buffer(source: Buffer, options?: unknown): Promise<ZipDirectory>;
  };

  const unzipper: {
    Open: typeof Open;
  };

  export default unzipper;
}
