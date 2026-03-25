/** Configuration required for Semaphore CI adapter */
export interface SemaphoreConfig {
  /** Organization URL, e.g. https://cpi-tech.semaphoreci.com */
  orgUrl: string;
  /** API authentication token */
  token: string;
}

/** Semaphore API project (list endpoint) */
export interface SemaphoreApiProject {
  metadata: {
    id: string;
    name: string;
    org_id: string;
    owner_id: string;
    description?: string;
  };
  spec: {
    repository?: {
      url?: string;
      owner?: string;
      name?: string;
      integration_type?: string;
    };
    visibility?: string;
    pipeline_file?: string;
  };
  kind: string;
  apiVersion: string;
}

/** Semaphore API pipeline (list endpoint) */
export interface SemaphoreApiPipelineListItem {
  ppl_id: string;
  name: string;
  state: 'DONE' | 'RUNNING' | 'STOPPING' | 'QUEUING' | 'PENDING' | 'INITIALIZING';
  result: 'PASSED' | 'STOPPED' | 'CANCELED' | 'FAILED' | '';
  branch_name: string;
  yaml_file_name: string;
  created_at: { seconds: number; nanos?: number };
  done_at?: { seconds: number; nanos?: number };
  wf_id: string;
  project_id: string;
  working_directory?: string;
}

/** Semaphore API pipeline detail (describe endpoint) */
export interface SemaphoreApiPipelineDetail {
  pipeline: {
    ppl_id: string;
    wf_id: string;
    project_id: string;
    name: string;
    state: string;
    result: string;
    branch_name: string;
    commit_sha: string;
    commit_message?: string;
    created_at: { seconds: number; nanos?: number };
    done_at?: { seconds: number; nanos?: number };
    yaml_file_name: string;
    working_directory?: string;
    running_at?: { seconds: number; nanos?: number };
  };
  blocks?: Array<{
    name: string;
    state: string;
    result: string;
  }>;
}

/** Semaphore API promotion */
export interface SemaphoreApiPromotion {
  name: string;
  status: string;
  pipeline_id?: string;
  triggered_by?: string;
  scheduled_at?: { seconds: number; nanos?: number };
}
