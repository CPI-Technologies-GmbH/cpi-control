export interface DOConfig {
  token: string;
}

export interface DODroplet {
  id: number;
  name: string;
  status: string; // new | active | off | archive
  memory: number;
  vcpus: number;
  disk: number;
  region: {
    slug: string;
    name: string;
  };
  image: {
    id: number;
    name: string;
    distribution: string;
  };
  networks: {
    v4: Array<{
      ip_address: string;
      netmask: string;
      gateway: string;
      type: string; // public | private
    }>;
  };
  tags: string[];
  created_at: string;
}

export interface DOMetrics {
  cpu: number; // percentage
  memory: {
    total: number;
    used: number;
    free: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
  };
  bandwidth: {
    inbound: number;
    outbound: number;
  };
}
