export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: Array<{
    type: string;
    text?: { type: string; text: string; emoji?: boolean };
    url?: string;
    action_id?: string;
    value?: string;
    style?: string;
  }>;
  fields?: Array<{ type: string; text: string }>;
  accessory?: Record<string, unknown>;
}

export function incidentOpenedTemplate(data: {
  serviceName: string;
  serviceUrl: string;
  severity: string;
  title: string;
  incidentId: string;
  dashboardUrl: string;
}): SlackBlock[] {
  const severityEmoji =
    data.severity === 'critical' ? ':rotating_light:' : data.severity === 'warning' ? ':warning:' : ':information_source:';

  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${severityEmoji} Incident Opened`,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${data.title}*\n${data.serviceName} (${data.serviceUrl})`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Severity:*\n${data.severity}` },
        { type: 'mrkdwn', text: `*Incident ID:*\n${data.incidentId}` },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View in OpsBoard', emoji: true },
          url: `${data.dashboardUrl}/incidents/${data.incidentId}`,
          action_id: 'view_incident',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Acknowledge', emoji: true },
          action_id: 'acknowledge_incident',
          value: data.incidentId,
          style: 'primary',
        },
      ],
    },
  ];
}

export function incidentResolvedTemplate(data: {
  serviceName: string;
  title: string;
  incidentId: string;
  resolvedBy: string;
  duration: string;
}): SlackBlock[] {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: ':white_check_mark: Incident Resolved',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${data.title}*\n${data.serviceName}`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Resolved by:*\n${data.resolvedBy}` },
        { type: 'mrkdwn', text: `*Duration:*\n${data.duration}` },
      ],
    },
  ];
}

export function deploymentFailedTemplate(data: {
  serviceName: string;
  provider: string;
  branch: string;
  commitMessage: string;
  author: string;
}): SlackBlock[] {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: ':x: Deployment Failed',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${data.serviceName}*\n${data.commitMessage}`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Provider:*\n${data.provider}` },
        { type: 'mrkdwn', text: `*Branch:*\n${data.branch}` },
        { type: 'mrkdwn', text: `*Author:*\n${data.author}` },
      ],
    },
  ];
}

export function healthDownTemplate(data: {
  serviceName: string;
  serviceUrl: string;
  statusCode?: number;
  responseTimeMs?: number;
  errorMessage?: string;
}): SlackBlock[] {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: ':red_circle: Service Down',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${data.serviceName}*\n${data.serviceUrl}`,
      },
    },
    {
      type: 'section',
      fields: [
        ...(data.statusCode
          ? [{ type: 'mrkdwn', text: `*Status Code:*\n${data.statusCode}` }]
          : []),
        ...(data.responseTimeMs
          ? [{ type: 'mrkdwn', text: `*Response Time:*\n${data.responseTimeMs}ms` }]
          : []),
        ...(data.errorMessage
          ? [{ type: 'mrkdwn', text: `*Error:*\n${data.errorMessage}` }]
          : []),
      ],
    },
  ];
}
