import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { logConfigs as api } from '@/lib/api';
import type { LogViewConfig, LogViewConfigData } from '@/types';
import type { LogColumn } from './ColumnSelector';
import type { LogSource, LogLevel } from '@/types';
import {
  Save,
  FolderOpen,
  Trash2,
  Pencil,
  Check,
  X,
  ChevronDown,
  BookmarkPlus,
} from 'lucide-react';
import clsx from 'clsx';

interface LogConfigManagerProps {
  /** Current filter state to save */
  currentState: {
    selectedServiceIds: string[];
    sources: LogSource[];
    levels: LogLevel[];
    since: string;
    search: string;
    columns: LogColumn[];
  };
  /** Called when a config is loaded */
  onLoad: (config: LogViewConfigData) => void;
}

export default function LogConfigManager({ currentState, onLoad }: LogConfigManagerProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);
  const [showSaveNew, setShowSaveNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const { data: configs = [] } = useQuery({
    queryKey: ['log-configs'],
    queryFn: () => api.list(),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; config: LogViewConfigData }) => api.create(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['log-configs'] });
      setActiveConfigId(created.id);
      setShowSaveNew(false);
      setNewName('');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; config?: LogViewConfigData } }) =>
      api.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['log-configs'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(id),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['log-configs'] });
      if (activeConfigId === deletedId) {
        setActiveConfigId(null);
      }
    },
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowSaveNew(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function buildConfigData(): LogViewConfigData {
    return {
      selectedServiceIds: currentState.selectedServiceIds,
      sources: currentState.sources,
      levels: currentState.levels,
      since: currentState.since,
      search: currentState.search,
      columns: currentState.columns,
    };
  }

  function handleSaveNew() {
    if (!newName.trim()) return;
    createMutation.mutate({ name: newName.trim(), config: buildConfigData() });
  }

  function handleOverwrite(id: string) {
    updateMutation.mutate({ id, data: { config: buildConfigData() } });
  }

  function handleLoad(config: LogViewConfig) {
    setActiveConfigId(config.id);
    onLoad(config.config);
    setOpen(false);
  }

  function handleDelete(id: string) {
    deleteMutation.mutate(id);
  }

  function handleRename(id: string) {
    if (!renameValue.trim()) return;
    updateMutation.mutate(
      { id, data: { name: renameValue.trim() } },
      {
        onSuccess: () => {
          setRenamingId(null);
          setRenameValue('');
        },
      }
    );
  }

  const activeConfig = configs.find((c) => c.id === activeConfigId);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border',
          activeConfig
            ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
            : 'btn-secondary'
        )}
      >
        <FolderOpen size={14} />
        {activeConfig ? activeConfig.name : 'Configs'}
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
          {/* Save current state */}
          <div className="p-2 border-b border-gray-800">
            {showSaveNew ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveNew()}
                  placeholder="Config name..."
                  className="input text-xs py-1 px-2 flex-1"
                  autoFocus
                />
                <button
                  onClick={handleSaveNew}
                  disabled={!newName.trim() || createMutation.isPending}
                  className="p-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-40 transition-colors"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => { setShowSaveNew(false); setNewName(''); }}
                  className="p-1 rounded text-gray-500 hover:text-gray-400 transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowSaveNew(true)}
                  className="flex items-center gap-1.5 flex-1 px-2 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
                >
                  <BookmarkPlus size={14} />
                  Save as new config
                </button>
                {activeConfigId && (
                  <button
                    onClick={() => handleOverwrite(activeConfigId)}
                    disabled={updateMutation.isPending}
                    className="flex items-center gap-1 px-2 py-1.5 rounded text-xs text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-40"
                    title="Overwrite current config"
                  >
                    <Save size={12} />
                    Update
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Config list */}
          <div className="max-h-64 overflow-y-auto">
            {configs.length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-600">
                No saved configs yet
              </div>
            ) : (
              <div className="p-1">
                {configs.map((config) => (
                  <div
                    key={config.id}
                    className={clsx(
                      'group flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors',
                      config.id === activeConfigId
                        ? 'bg-purple-500/10 text-purple-400'
                        : 'text-gray-300 hover:bg-gray-800'
                    )}
                  >
                    {renamingId === config.id ? (
                      <div className="flex items-center gap-1 flex-1">
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleRename(config.id)}
                          className="input text-xs py-0.5 px-1.5 flex-1"
                          autoFocus
                        />
                        <button onClick={() => handleRename(config.id)} className="p-0.5 text-emerald-400">
                          <Check size={12} />
                        </button>
                        <button onClick={() => setRenamingId(null)} className="p-0.5 text-gray-500">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => handleLoad(config)}
                          className="flex-1 text-left truncate"
                        >
                          {config.name}
                        </button>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => {
                              setRenamingId(config.id);
                              setRenameValue(config.name);
                            }}
                            className="p-0.5 rounded text-gray-500 hover:text-gray-300 transition-colors"
                            title="Rename"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            onClick={() => handleDelete(config.id)}
                            className="p-0.5 rounded text-gray-500 hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
