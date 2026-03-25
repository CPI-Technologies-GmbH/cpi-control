import type {
  GitHubApiCommit,
  GitHubApiWorkflowRun,
  GitHubCommit,
  GitHubWorkflowRun,
} from './types.js';

export function mapCommit(apiCommit: GitHubApiCommit): GitHubCommit {
  return {
    sha: apiCommit.sha,
    message: apiCommit.commit.message,
    author: {
      name: apiCommit.commit.author.name,
      email: apiCommit.commit.author.email,
      date: apiCommit.commit.author.date,
    },
    url: apiCommit.html_url,
  };
}

export function mapWorkflowRun(apiRun: GitHubApiWorkflowRun): GitHubWorkflowRun {
  return {
    id: apiRun.id,
    name: apiRun.name,
    headBranch: apiRun.head_branch,
    headSha: apiRun.head_sha,
    status: apiRun.status,
    conclusion: apiRun.conclusion,
    htmlUrl: apiRun.html_url,
    createdAt: apiRun.created_at,
    updatedAt: apiRun.updated_at,
    runStartedAt: apiRun.run_started_at,
    actor: {
      login: apiRun.actor.login,
      avatarUrl: apiRun.actor.avatar_url,
    },
  };
}

export function workflowRunToDeploymentStatus(
  conclusion: string | null,
  status: string
): string {
  if (status === 'queued') return 'pending';
  if (status === 'in_progress') return 'building';
  if (conclusion === 'success') return 'success';
  if (conclusion === 'failure') return 'failed';
  if (conclusion === 'cancelled') return 'cancelled';
  return 'pending';
}
