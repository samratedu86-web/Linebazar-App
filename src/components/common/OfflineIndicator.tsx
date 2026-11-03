import React from 'react';
import { useOnlineStatus } from '../../hooks/usePWAInstall';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 shadow-xl border border-amber-400">
      <span className="h-2 w-2 rounded-full bg-slate-950 animate-ping" />
      <span>Offline Mode — Using cached Kolkata transit data.</span>
    </div>
  );
};
