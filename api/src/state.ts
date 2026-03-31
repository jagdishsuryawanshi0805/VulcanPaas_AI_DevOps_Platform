import { Deployment, RepoConfig, AppEntry } from './types';

// Let deployments be exported but mutable, wait, export an object wrapper or use let.
// In typescript, `export const deployments = []` is totally fine because we use array methods.
export const deployments: Deployment[] = [];
export const repoRegistry: Map<string, RepoConfig> = new Map();
export const portRegistry: Map<string, number> = new Map();   // "repo:branch" → port
export const appRegistry: Map<string, AppEntry> = new Map();  // slug → AppEntry

// Managing the port allocation safely
let nextPort = 9000;

export function allocatePort(repoKey: string): number {
  if (portRegistry.has(repoKey)) return portRegistry.get(repoKey)!;
  const port = nextPort++;
  portRegistry.set(repoKey, port);
  return port;
}
