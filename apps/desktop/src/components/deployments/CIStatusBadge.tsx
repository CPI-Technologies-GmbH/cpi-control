import type { DeploymentStatus } from '@/types';
import { deploymentStatusColor } from '@/lib/formatters';
import { Loader2, CheckCircle2, XCircle, Clock, Ban, Rocket } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  status: DeploymentStatus;
}

function StatusIcon({ status }: Props) {
  switch (status) {
    case 'pending':
      return <Clock size={12} />;
    case 'building':
    case 'deploying':
      return <Loader2 size={12} className="animate-spin" />;
    case 'success':
      return <CheckCircle2 size={12} />;
    case 'failed':
      return <XCircle size={12} />;
    case 'cancelled':
      return <Ban size={12} />;
    default:
      return <Rocket size={12} />;
  }
}

export default function CIStatusBadge({ status }: Props) {
  return (
    <span className={clsx('badge gap-1', deploymentStatusColor(status))}>
      <StatusIcon status={status} />
      {status}
    </span>
  );
}
