export interface Deployment {
  id: string;
  repo: string;
  branch: string;
  commitHash: string;
  message: string;
  status: 'active' | 'failed' | 'deploying';
  date: string;
  review?: string;
  url?: string;
}

export interface RepoConfig {
  fullName: string;
  cloneUrl: string;
  lastBranch?: string;
  lastDeployment?: string;
  registered: string;
}

export interface AppEntry {
  slug: string;
  repo: string;
  branch: string;
  port: number;
  url: string;
  projectType: string;
  deployedAt: string;
  status: 'running' | 'failed';
}

export type ProjectType = 'dockerfile' | 'react' | 'vite' | 'node' | 'static' | 'unknown';
