import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

interface UpdateState {
  version: string;
  body?: string;
  downloadAndInstall: () => Promise<void>;
}

export default function UpdateBanner() {
  const [updateInfo, setUpdateInfo] = useState<UpdateState | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    async function checkForUpdate() {
      try {
        // Dynamic import — only available in Tauri desktop context
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (update) {
          setUpdateInfo({
            version: update.version,
            body: update.body ?? undefined,
            downloadAndInstall: () => update.downloadAndInstall(),
          });
        }
      } catch {
        // Silently ignore — likely running in dev mode or browser
      }
    }

    const timer = setTimeout(checkForUpdate, 5000);
    return () => clearTimeout(timer);
  }, []);

  if (!updateInfo || dismissed) return null;

  async function handleInstall() {
    if (!updateInfo) return;
    setInstalling(true);
    try {
      await updateInfo.downloadAndInstall();
      // Tauri will restart the app after install
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch {
      setInstalling(false);
    }
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-blue-600/90 backdrop-blur-sm px-4 py-2 flex items-center justify-center gap-4 text-sm text-white">
      <Download size={14} />
      <span>
        Version {updateInfo.version} ist verfügbar
      </span>
      <button
        onClick={handleInstall}
        disabled={installing}
        className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-medium transition-colors"
      >
        {installing ? 'Installiert...' : 'Update & Neustart'}
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 hover:bg-white/20 rounded transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}
