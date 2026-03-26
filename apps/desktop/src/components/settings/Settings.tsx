import { useState } from 'react';
import IntegrationsHub from './IntegrationsHub';
import NotificationSettings from './NotificationSettings';
import GeneralSettings from './GeneralSettings';
import AgentManagement from '../agent/AgentManagement';
import { Settings as SettingsIcon, Plug, Bell, Sliders, Server } from 'lucide-react';
import clsx from 'clsx';

type Tab = 'general' | 'integrations' | 'notifications' | 'agent';

const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'general', label: 'General', icon: <Sliders size={14} /> },
  { key: 'integrations', label: 'Integrations', icon: <Plug size={14} /> },
  { key: 'notifications', label: 'Notifications', icon: <Bell size={14} /> },
  { key: 'agent', label: 'Agent', icon: <Server size={14} /> },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>('general');

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
      {activeTab === 'general' && <GeneralSettings />}
      {activeTab === 'integrations' && <IntegrationsHub />}
      {activeTab === 'notifications' && <NotificationSettings />}
      {activeTab === 'agent' && <AgentManagement />}
    </div>
  );
}
