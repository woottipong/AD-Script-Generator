/** The Job a `/jobs/:jobId` URL opens; the URL, not the server, says which Job this tab works on. */
export function jobIdFromPath(pathname: string): string | null {
  return /^\/jobs\/([^/]+)\/?$/.exec(pathname)?.[1] ?? null;
}

export function jobPath(jobId: string): string {
  return `/jobs/${encodeURIComponent(jobId)}`;
}
