/// <reference types="vite/client" />

declare module 'mp4box' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createFile(keepMdatData?: boolean): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const DataStream: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const Endianness: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const MP4BoxBuffer: any;
}
