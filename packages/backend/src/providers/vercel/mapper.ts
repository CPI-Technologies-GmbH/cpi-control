import type { VercelApiDeployment, VercelDeployment } from './types.js';

export function mapDeployment(apiDeployment: VercelApiDeployment): VercelDeployment {
  return {
    uid: apiDeployment.uid,
    name: apiDeployment.name,
    url: apiDeployment.url,
    state: apiDeployment.state,
    readyState: apiDeployment.readyState,
    created: apiDeployment.created,
    buildingAt: apiDeployment.buildingAt,
    ready: apiDeployment.ready,
    creator: {
      uid: apiDeployment.creator.uid,
      username: apiDeployment.creator.username,
    },
    meta: apiDeployment.meta
      ? {
          githubCommitSha: apiDeployment.meta.githubCommitSha,
          githubCommitMessage: apiDeployment.meta.githubCommitMessage,
          githubCommitRef: apiDeployment.meta.githubCommitRef,
          githubDeployment: apiDeployment.meta.githubDeployment,
          githubOrg: apiDeployment.meta.githubOrg,
          githubRepo: apiDeployment.meta.githubRepo,
        }
      : undefined,
  };
}

export function vercelStateToDeploymentStatus(state: string): string {
  switch (state) {
    case 'QUEUED':
    case 'INITIALIZING':
      return 'pending';
    case 'BUILDING':
      return 'building';
    case 'READY':
      return 'success';
    case 'ERROR':
      return 'failed';
    case 'CANCELED':
      return 'cancelled';
    default:
      return 'pending';
  }
}
