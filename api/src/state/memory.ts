import { Deployment, RepoConfig, AppEntry } from '../types';

export const deployments: Deployment[] = [];
export const repoRegistry: Map<string, RepoConfig> = new Map();
export const portRegistry: Map<string, number> = new Map();
export const appRegistry: Map<string, AppEntry> = new Map();

let nextPort = 9000;

export function allocatePort(repoKey: string): number {
  if (portRegistry.has(repoKey)) return portRegistry.get(repoKey)!;
  const port = nextPort++;
  portRegistry.set(repoKey, port);
  return port;
}
