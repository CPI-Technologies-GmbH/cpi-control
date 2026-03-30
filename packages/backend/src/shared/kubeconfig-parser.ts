/** Extract a YAML value from "key: value" (handles quoted strings, strips inline comments) */
export function yamlValue(line: string): string {
  const idx = line.indexOf(':');
  if (idx === -1) return '';
  let val = line.slice(idx + 1).trim();
  // Strip inline YAML comments (but not inside quoted strings)
  if (!val.startsWith("'") && !val.startsWith('"')) {
    const commentIdx = val.indexOf(' #');
    if (commentIdx !== -1) {
      val = val.slice(0, commentIdx).trim();
    }
  }
  return val.replace(/^['"]|['"]$/g, '');
}

/** Parse kubeconfig YAML content to extract apiServer, token, caCert, clientCert, clientKey.
 *  Respects current-context to select the correct cluster and user.
 *  Handles both `- name:` before and after `- context:`/`- cluster:` entry patterns. */
export function parseKubeconfig(content: string): {
  apiServer?: string;
  token?: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
} {
  const lines = content.split('\n');

  // Step 1: Find current-context
  let currentContext = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('current-context:')) {
      currentContext = yamlValue(trimmed);
      break;
    }
  }

  // Step 1b: If no current-context, count contexts to auto-select if only one
  let contextCount = 0;
  if (!currentContext) {
    let inContexts = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (line.match(/^\S/) && trimmed.startsWith('contexts:')) { inContexts = true; continue; }
      if (inContexts && line.match(/^\S/) && !trimmed.startsWith('-')) { inContexts = false; continue; }
      if (inContexts && (trimmed.startsWith('- context:') || trimmed === '- context:' || trimmed.startsWith('- name:'))) {
        // Count unique context entries (both `- context:` and `- name:` start a block)
        if (trimmed.startsWith('- ')) contextCount++;
      }
    }
    // Divide by 2 wouldn't be right since each context has one `- name:` OR one `- context:` as list start
    // Actually each context entry is one list item, started by either `- context:` or `- name:`
    // We'll count properly below when parsing
  }

  // Step 2: Parse contexts to find which cluster name and user name the current-context uses
  let targetCluster = '';
  let targetUser = '';
  {
    let inContexts = false;
    let inContextBlock = false;
    let contextName = '';
    let clusterName = '';
    let userName = '';
    let parsedContextCount = 0;
    let singleContextName = '';
    let singleCluster = '';
    let singleUser = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (line.match(/^\S/) && trimmed.startsWith('contexts:')) {
        inContexts = true;
        inContextBlock = false;
        continue;
      }
      if (inContexts && line.match(/^\S/) && !trimmed.startsWith('-')) {
        inContexts = false;
        continue;
      }
      if (!inContexts) continue;

      // Handle both `- context:` and `- name:` as list item starts
      const isNewItem = trimmed.startsWith('- context:') || trimmed === '- context:' || trimmed.startsWith('- name:');
      if (isNewItem) {
        // Save previous context if matched
        if (inContextBlock && contextName === currentContext && currentContext) {
          targetCluster = clusterName;
          targetUser = userName;
        }
        if (inContextBlock) {
          parsedContextCount++;
          singleContextName = contextName;
          singleCluster = clusterName;
          singleUser = userName;
        }
        inContextBlock = true;
        contextName = '';
        clusterName = '';
        userName = '';

        // If the list item itself starts with `- name:`, extract it
        if (trimmed.startsWith('- name:')) {
          contextName = yamlValue(trimmed);
        }
        // If `- context:` has inline content, that's just the marker
        continue;
      }
      if (inContextBlock) {
        if (trimmed.startsWith('cluster:')) clusterName = yamlValue(trimmed);
        else if (trimmed.startsWith('user:')) userName = yamlValue(trimmed);
        else if (trimmed.startsWith('name:')) contextName = yamlValue(trimmed);
      }
    }
    // Check last context block
    if (inContextBlock && contextName === currentContext && currentContext) {
      targetCluster = clusterName;
      targetUser = userName;
    }
    if (inContextBlock) {
      parsedContextCount++;
      singleContextName = contextName;
      singleCluster = clusterName;
      singleUser = userName;
    }

    // Auto-select if only 1 context exists and no current-context was specified
    if (!currentContext && parsedContextCount === 1) {
      targetCluster = singleCluster;
      targetUser = singleUser;
      currentContext = singleContextName;
    }
  }

  // Step 3: Parse clusters to find the matching cluster's server, ca-cert
  let apiServer: string | undefined;
  let caCert: string | undefined;
  {
    let inClusters = false;
    let inClusterBlock = false;
    let clusterName = '';
    let server = '';
    let ca = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (line.match(/^\S/) && trimmed.startsWith('clusters:')) {
        inClusters = true;
        inClusterBlock = false;
        continue;
      }
      if (inClusters && line.match(/^\S/) && !trimmed.startsWith('-')) {
        inClusters = false;
        continue;
      }
      if (!inClusters) continue;

      // Handle both `- cluster:` and `- name:` as list item starts
      const isNewItem = trimmed.startsWith('- cluster:') || trimmed === '- cluster:' || trimmed.startsWith('- name:');
      if (isNewItem) {
        if (inClusterBlock && clusterName === targetCluster) {
          apiServer = server || undefined;
          caCert = ca || undefined;
        }
        inClusterBlock = true;
        // Reset but preserve name if `- name:` started this block
        if (trimmed.startsWith('- name:')) {
          clusterName = yamlValue(trimmed);
          server = '';
          ca = '';
        } else {
          clusterName = '';
          server = '';
          ca = '';
        }
        continue;
      }
      if (inClusterBlock) {
        if (trimmed.startsWith('server:')) server = yamlValue(trimmed);
        else if (trimmed.startsWith('certificate-authority-data:')) ca = yamlValue(trimmed);
        else if (trimmed.startsWith('name:')) clusterName = yamlValue(trimmed);
      }
    }
    if (inClusterBlock && clusterName === targetCluster) {
      apiServer = server || undefined;
      caCert = ca || undefined;
    }
  }

  // Step 4: Parse users to find matching user's credentials
  let token: string | undefined;
  let clientCert: string | undefined;
  let clientKey: string | undefined;
  {
    let inUsers = false;
    let inUserBlock = false;
    let userName = '';
    let userToken = '';
    let cert = '';
    let key = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (line.match(/^\S/) && trimmed.startsWith('users:')) {
        inUsers = true;
        inUserBlock = false;
        continue;
      }
      if (inUsers && line.match(/^\S/) && !trimmed.startsWith('-')) {
        inUsers = false;
        continue;
      }
      if (!inUsers) continue;

      if (trimmed.startsWith('- name:')) {
        if (inUserBlock && userName === targetUser) {
          token = userToken || undefined;
          clientCert = cert || undefined;
          clientKey = key || undefined;
        }
        inUserBlock = true;
        userName = yamlValue(trimmed);
        userToken = '';
        cert = '';
        key = '';
        continue;
      }
      if (inUserBlock) {
        if (trimmed.startsWith('token:')) userToken = yamlValue(trimmed);
        else if (trimmed.startsWith('client-certificate-data:')) cert = yamlValue(trimmed);
        else if (trimmed.startsWith('client-key-data:')) key = yamlValue(trimmed);
      }
    }
    if (inUserBlock && userName === targetUser) {
      token = userToken || undefined;
      clientCert = cert || undefined;
      clientKey = key || undefined;
    }
  }

  // Fallback: if no apiServer found via context matching, grab the first server we see
  if (!apiServer) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('server:')) {
        apiServer = yamlValue(trimmed);
        break;
      }
    }
  }

  return { apiServer, token, caCert, clientCert, clientKey };
}
