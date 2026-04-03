import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { updates } from '@/lib/api';
import { Download, X } from 'lucide-react';

function isNewer(latest: string, current: string): boolean {
  const [lMaj, lMin, lPatch] = latest.split('.').map(Number);
  const [cMaj, cMin, cPatch] = current.split('.').map(Number);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPatch > cPatch;
}

export default function UpdateBanner() {
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ['updates', 'app-banner'],
    queryFn: () => updates.checkApp(),
    refetchInterval: 30 * 60 * 1000, // re-check every 30 min
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  const currentVersion = data?.currentVersion ?? '0.0.0';
  const latestVersion = data?.latestVersion;
  const hasUpdate = latestVersion && isNewer(latestVersion, currentVersion);

  // Find the macOS .dmg download URL from assets
  const dmgAsset = data?.assets.find((a) => a.name.includes('aarch64') && a.name.endsWith('.dmg'))
    ?? data?.assets.find((a) => a.name.endsWith('.dmg'));

  if (!hasUpdate || dismissed) return null;

  function handleDownload() {
    const url = dmgAsset?.url ?? `https://github.com/CPI-Technologies-GmbH/cpi-control/releases/tag/latest`;
    window.open(url, '_blank');
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-blue-600/90 backdrop-blur-sm px-4 py-2 flex items-center justify-center gap-4 text-sm text-white">
      <Download size={14} />
      <span>
        Version {latestVersion} ist verfügbar (installiert: {currentVersion})
      </span>
      <button
        onClick={handleDownload}
        className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-xs font-medium transition-colors"
      >
        Herunterladen
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
