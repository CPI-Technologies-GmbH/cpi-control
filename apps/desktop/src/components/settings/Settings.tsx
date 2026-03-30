import { useState } from 'react';
import IntegrationsHub from './IntegrationsHub';
import NotificationSettings from './NotificationSettings';
import GeneralSettings from './GeneralSettings';
import BackendManagement from './BackendManagement';
import UpdateSettings from './UpdateSettings';
import LicenseSettings from './LicenseSettings';
import AgentManagement from '../agent/AgentManagement';
import { Settings as SettingsIcon, Plug, Bell, Sliders, Server, Cpu, Download, Key } from 'lucide-react';
import clsx from 'clsx';

type Tab = 'license' | 'general' | 'integrations' | 'notifications' | 'agent' | 'backend' | 'updates';

const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'license', label: 'License', icon: <Key size={14} /> },
  { key: 'general', label: 'General', icon: <Sliders size={14} /> },
  { key: 'integrations', label: 'Integrations', icon: <Plug size={14} /> },
  { key: 'notifications', label: 'Notifications', icon: <Bell size={14} /> },
  { key: 'agent', label: 'Agent', icon: <Server size={14} /> },
  { key: 'backend', label: 'Backend', icon: <Cpu size={14} /> },
  { key: 'updates', label: 'Updates', icon: <Download size={14} /> },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>('license');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <SettingsIcon size={20} className="text-blue-400" />
        <h1 className="text-xl font-bold text-gray-100">Settings</h1>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-gray-800 pb-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={clsx(
              'flex items-center gap-1.5 pb-3 text-sm font-medium transition-colors',
              activeTab === tab.key ? 'tab-active' : 'tab-inactive'
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'license' && <LicenseSettings />}
      {activeTab === 'general' && <GeneralSettings />}
      {activeTab === 'integrations' && <IntegrationsHub />}
      {activeTab === 'notifications' && <NotificationSettings />}
      {activeTab === 'agent' && <AgentManagement />}
      {activeTab === 'backend' && <BackendManagement />}
      {activeTab === 'updates' && <UpdateSettings />}

      {/* CPI Technologies branding */}
      <div className="pt-8 border-t border-gray-800/50 flex flex-col items-center gap-2">
        <p className="text-xs text-gray-600">Powered by</p>
        <a href="https://cpitech.io" target="_blank" rel="noopener noreferrer" className="opacity-40 hover:opacity-70 transition-opacity">
          <img src="https://www.cpitech.io/images/68f8d51c2f57198f96420746_logo.svg" alt="CPI Technologies GmbH" className="h-6" />
        </a>
      </div>
    </div>
  );
}
