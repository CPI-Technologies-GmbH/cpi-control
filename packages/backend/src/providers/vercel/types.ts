export interface VercelConfig {
  token: string;
  teamId?: string;
}

export interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
  latestDeployments: VercelDeployment[];
}

export interface VercelDeployment {
  uid: string;
  name: string;
  url: string;
  state: string; // BUILDING | ERROR | INITIALIZING | QUEUED | READY | CANCELED
  readyState: string;
  created: number; // timestamp ms
  buildingAt: number;
  ready: number;
  creator: {
    uid: string;
    username: string;
  };
  meta?: {
    githubCommitSha?: string;
    githubCommitMessage?: string;
    githubCommitRef?: string;
    githubDeployment?: string;
    githubOrg?: string;
    githubRepo?: string;
  };
}

export interface VercelApiDeployment {
  uid: string;
  name: string;
  url: string;
  state: string;
  readyState: string;
  created: number;
  buildingAt: number;
  ready: number;
  creator: {
    uid: string;
    username: string;
  };
  meta?: Record<string, string>;
}

export interface VercelCronJob {
  projectId: string;
  projectName: string;
  path: string;
  schedule: string;
  lastRunAt?: string;
  lastRunStatus?: string;
}

export interface VercelProjectDetails {
  id: string;
  name: string;
  framework: string | null;
  nodeVersion: string | null;
  buildCommand: string | null;
  outputDirectory: string | null;
  installCommand: string | null;
  devCommand: string | null;
  rootDirectory: string | null;
  productionDomain: string | null;
  domains: string[];
  envVarsCount: number;
  analytics: {
    speedInsights: boolean;
    webAnalytics: boolean;
  };
  gitRepo: {
    org: string;
    repo: string;
    type: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  latestDeployments: VercelDeploymentSummary[];
}

export interface VercelDeploymentSummary {
  uid: string;
  url: string;
  state: string;
  created: number;
  ready: number | null;
  target: string | null; // 'production' | 'preview' | null
  creator: string;
  branch: string | null;
  commitMessage: string | null;
  commitSha: string | null;
}
