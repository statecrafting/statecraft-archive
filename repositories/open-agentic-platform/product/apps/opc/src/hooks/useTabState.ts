import { useCallback, useMemo } from 'react';
import { useTabContext } from '@/contexts/TabContext';
import { Tab } from '@/contexts/TabContext';
import type { OpcBundle } from '@/types/factoryBundle';

interface UseTabStateReturn {
  // State
  tabs: Tab[];
  activeTab: Tab | undefined;
  activeTabId: string | null;
  tabCount: number;
  chatTabCount: number;
  agentTabCount: number;
  
  // Operations
  createChatTab: (projectId?: string, title?: string, projectPath?: string) => string;
  createAgentTab: (agentRunId: string, agentName: string) => string;
  createAgentExecutionTab: (agent: any, tabId: string, projectPath?: string) => string;
  createProjectsTab: () => string | null;
  createAgentsTab: () => string | null;
  createUsageTab: () => string | null;
  createMCPTab: () => string | null;
  createSettingsTab: () => string | null;
  createClaudeMdTab: () => string | null;
  /** Open a workspace markdown file (e.g. feature spec) in the markdown editor tab. */
  createSpecMarkdownTab: (absolutePath: string, title?: string) => string | null;
  createClaudeFileTab: (fileId: string, fileName: string) => string;
  createCreateAgentTab: () => string;
  createImportAgentTab: () => string;
  createGovernanceTab: (projectPath?: string) => string | null;
  createXrayTab: (projectPath?: string) => string | null;
  createSemanticSearchTab: (projectPath?: string) => string | null;
  createCallGraphTab: (projectPath?: string) => string | null;
  createGitContextTab: (projectPath?: string) => string | null;
  createCheckpointTab: (projectPath?: string) => string | null;
  /** Spec 172 — open the Live Sessions panel. Single-instance. */
  createLiveSessionsTab: (projectPath?: string) => string | null;
  createFactoryTab: (projectPath?: string, bundle?: OpcBundle) => string | null;
  createWorkspaceProjectsTab: () => string | null;
  createPortfolioTab: (projectPath?: string) => string | null;
  createPromotionTab: (projectPath?: string) => string | null;
  closeTab: (id: string, force?: boolean) => Promise<boolean>;
  closeCurrentTab: () => Promise<boolean>;
  switchToTab: (id: string) => void;
  switchToNextTab: () => void;
  switchToPreviousTab: () => void;
  switchToTabByIndex: (index: number) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;
  updateTabTitle: (id: string, title: string) => void;
  updateTabStatus: (id: string, status: Tab['status']) => void;
  markTabAsChanged: (id: string, hasChanges: boolean) => void;
  findTabBySessionId: (sessionId: string) => Tab | undefined;
  findTabByAgentRunId: (agentRunId: string) => Tab | undefined;
  findTabByType: (type: Tab['type']) => Tab | undefined;
  canAddTab: () => boolean;
}

export const useTabState = (): UseTabStateReturn => {
  const {
    tabs,
    activeTabId,
    addTab,
    removeTab,
    updateTab,
    setActiveTab,
    getTabById,
    getTabsByType
  } = useTabContext();

  const activeTab = useMemo(() => 
    activeTabId ? getTabById(activeTabId) : undefined,
    [activeTabId, getTabById]
  );

  const tabCount = tabs.length;
  const chatTabCount = useMemo(() => getTabsByType('chat').length, [getTabsByType]);
  const agentTabCount = useMemo(() => getTabsByType('agent').length, [getTabsByType]);

  const createChatTab = useCallback((projectId?: string, title?: string, projectPath?: string): string => {
    const tabTitle = title || `Chat ${chatTabCount + 1}`;
    return addTab({
      type: 'chat',
      title: tabTitle,
      sessionId: projectId,
      initialProjectPath: projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'message-square'
    });
  }, [addTab, chatTabCount]);

  const createAgentTab = useCallback((agentRunId: string, agentName: string): string => {
    // Check if tab already exists
    const existingTab = tabs.find(tab => tab.agentRunId === agentRunId);
    if (existingTab) {
      setActiveTab(existingTab.id);
      return existingTab.id;
    }

    return addTab({
      type: 'agent',
      title: agentName,
      agentRunId,
      status: 'running',
      hasUnsavedChanges: false,
      icon: 'bot'
    });
  }, [addTab, tabs, setActiveTab]);

  const createProjectsTab = useCallback((): string | null => {
    // Allow multiple projects tabs
    return addTab({
      type: 'projects',
      title: 'Projects',
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'folder'
    });
  }, [addTab]);

  const createAgentsTab = useCallback((): string | null => {
    // Check if agents tab already exists (singleton)
    const existingTab = tabs.find(tab => tab.type === 'agents');
    if (existingTab) {
      setActiveTab(existingTab.id);
      return existingTab.id;
    }

    return addTab({
      type: 'agents',
      title: 'Agents',
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'bot'
    });
  }, [addTab, tabs, setActiveTab]);

  const createUsageTab = useCallback((): string | null => {
    // Check if usage tab already exists (singleton)
    const existingTab = tabs.find(tab => tab.type === 'usage');
    if (existingTab) {
      setActiveTab(existingTab.id);
      return existingTab.id;
    }

    return addTab({
      type: 'usage',
      title: 'Usage',
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'bar-chart'
    });
  }, [addTab, tabs, setActiveTab]);

  const createMCPTab = useCallback((): string | null => {
    // Check if MCP tab already exists (singleton)
    const existingTab = tabs.find(tab => tab.type === 'mcp');
    if (existingTab) {
      setActiveTab(existingTab.id);
      return existingTab.id;
    }

    return addTab({
      type: 'mcp',
      title: 'MCP Servers',
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'server'
    });
  }, [addTab, tabs, setActiveTab]);

  const createSettingsTab = useCallback((): string | null => {
    // Check if settings tab already exists (singleton)
    const existingTab = tabs.find(tab => tab.type === 'settings');
    if (existingTab) {
      setActiveTab(existingTab.id);
      return existingTab.id;
    }

    return addTab({
      type: 'settings',
      title: 'Settings',
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'settings'
    });
  }, [addTab, tabs, setActiveTab]);

  const createClaudeMdTab = useCallback((): string | null => {
    // Singleton for the global system prompt tab (no spec path)
    const existingTab = tabs.find(
      tab => tab.type === 'claude-md' && !tab.specMarkdownAbsolutePath
    );
    if (existingTab) {
      setActiveTab(existingTab.id);
      return existingTab.id;
    }

    return addTab({
      type: 'claude-md',
      title: 'CLAUDE.md',
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'file-text'
    });
  }, [addTab, tabs, setActiveTab]);

  const createSpecMarkdownTab = useCallback(
    (absolutePath: string, title?: string): string | null => {
      const normalized = absolutePath.trim();
      if (!normalized) return null;
      const existingTab = tabs.find(
        tab => tab.type === 'claude-md' && tab.specMarkdownAbsolutePath === normalized
      );
      if (existingTab) {
        setActiveTab(existingTab.id);
        return existingTab.id;
      }
      const label =
        title?.trim() ||
        normalized.split(/[/\\]/).filter(Boolean).pop() ||
        'Spec';
      return addTab({
        type: 'claude-md',
        title: label,
        specMarkdownAbsolutePath: normalized,
        status: 'idle',
        hasUnsavedChanges: false,
        icon: 'file-text',
      });
    },
    [addTab, tabs, setActiveTab]
  );

  const createClaudeFileTab = useCallback((fileId: string, fileName: string): string => {
    // Check if tab already exists for this file
    const existingTab = tabs.find(tab => tab.type === 'claude-file' && tab.claudeFileId === fileId);
    if (existingTab) {
      setActiveTab(existingTab.id);
      return existingTab.id;
    }

    return addTab({
      type: 'claude-file',
      title: fileName,
      claudeFileId: fileId,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'file-text'
    });
  }, [addTab, tabs, setActiveTab]);

  const createAgentExecutionTab = useCallback((agent: any, _tabId: string, projectPath?: string): string => {
    return addTab({
      type: 'agent-execution',
      title: `Run: ${agent.name}`,
      agentData: agent,
      projectPath: projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'bot'
    });
  }, [addTab]);

  const createCreateAgentTab = useCallback((): string => {
    // Check if create agent tab already exists (singleton)
    const existingTab = tabs.find(tab => tab.type === 'create-agent');
    if (existingTab) {
      setActiveTab(existingTab.id);
      return existingTab.id;
    }

    return addTab({
      type: 'create-agent',
      title: 'Create Agent',
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'plus'
    });
  }, [addTab, tabs, setActiveTab]);

  const createImportAgentTab = useCallback((): string => {
    // Check if import agent tab already exists (singleton)
    const existingTab = tabs.find(tab => tab.type === 'import-agent');
    if (existingTab) {
      setActiveTab(existingTab.id);
      return existingTab.id;
    }

    return addTab({
      type: 'import-agent',
      title: 'Import Agent',
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'import'
    });
  }, [addTab, tabs, setActiveTab]);

  const createGovernanceTab = useCallback((projectPath?: string): string | null => {
    const existingTab = tabs.find(tab => tab.type === 'governance');
    if (existingTab) {
      if (projectPath) updateTab(existingTab.id, { projectPath });
      setActiveTab(existingTab.id);
      return existingTab.id;
    }
    return addTab({
      type: 'governance',
      title: 'Governance',
      projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'git-branch'
    });
  }, [addTab, tabs, setActiveTab, updateTab]);

  const createXrayTab = useCallback((projectPath?: string): string | null => {
    const existingTab = tabs.find(tab => tab.type === 'xray');
    if (existingTab) {
      if (projectPath) updateTab(existingTab.id, { projectPath });
      setActiveTab(existingTab.id);
      return existingTab.id;
    }
    return addTab({
      type: 'xray',
      title: 'Xray',
      projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'scan-line'
    });
  }, [addTab, tabs, setActiveTab, updateTab]);

  const createSemanticSearchTab = useCallback((projectPath?: string): string | null => {
    const existingTab = tabs.find(tab => tab.type === 'semantic-search');
    if (existingTab) {
      if (projectPath) updateTab(existingTab.id, { projectPath });
      setActiveTab(existingTab.id);
      return existingTab.id;
    }
    return addTab({
      type: 'semantic-search',
      title: 'Semantic Search',
      projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'search'
    });
  }, [addTab, tabs, setActiveTab, updateTab]);

  const createCallGraphTab = useCallback((projectPath?: string): string | null => {
    const existingTab = tabs.find(tab => tab.type === 'call-graph');
    if (existingTab) {
      if (projectPath) updateTab(existingTab.id, { projectPath });
      setActiveTab(existingTab.id);
      return existingTab.id;
    }
    return addTab({
      type: 'call-graph',
      title: 'Call Graph',
      projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'network'
    });
  }, [addTab, tabs, setActiveTab, updateTab]);

  const createGitContextTab = useCallback((projectPath?: string): string | null => {
    const existingTab = tabs.find(tab => tab.type === 'git-context');
    if (existingTab) {
      if (projectPath) updateTab(existingTab.id, { projectPath });
      setActiveTab(existingTab.id);
      return existingTab.id;
    }
    return addTab({
      type: 'git-context',
      title: 'Git Context',
      projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'git-commit'
    });
  }, [addTab, tabs, setActiveTab, updateTab]);

  const createCheckpointTab = useCallback((projectPath?: string): string | null => {
    const existingTab = tabs.find(tab => tab.type === 'checkpoint');
    if (existingTab) {
      if (projectPath) updateTab(existingTab.id, { projectPath });
      setActiveTab(existingTab.id);
      return existingTab.id;
    }
    return addTab({
      type: 'checkpoint',
      title: 'Checkpoint',
      projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'history'
    });
  }, [addTab, tabs, setActiveTab, updateTab]);

  // Spec 172 — Live agent-session introspection. Single-instance panel that
  // surfaces every connected Claude session + active orchestrator workflow
  // with force-disconnect for runaway agents.
  const createLiveSessionsTab = useCallback((projectPath?: string): string | null => {
    const existingTab = tabs.find(tab => tab.type === 'live-sessions');
    if (existingTab) {
      if (projectPath) updateTab(existingTab.id, { projectPath });
      setActiveTab(existingTab.id);
      return existingTab.id;
    }
    return addTab({
      type: 'live-sessions',
      title: 'Live Sessions',
      projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'activity'
    });
  }, [addTab, tabs, setActiveTab, updateTab]);

  const createFactoryTab = useCallback((projectPath?: string, bundle?: OpcBundle): string | null => {
    const existingTab = tabs.find(tab => tab.type === 'factory');
    if (existingTab) {
      const updates: Partial<Tab> = {};
      if (projectPath) updates.projectPath = projectPath;
      if (bundle) updates.factoryBundle = bundle;
      if (Object.keys(updates).length > 0) updateTab(existingTab.id, updates);
      setActiveTab(existingTab.id);
      return existingTab.id;
    }
    return addTab({
      type: 'factory',
      title: 'Factory',
      projectPath,
      factoryBundle: bundle,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'workflow'
    });
  }, [addTab, tabs, setActiveTab, updateTab]);

  // Spec 112 Phase 8 — workspace projects panel. Single-instance tab; the
  // panel renders the duplex-synced project list and lets the user open a
  // row to clone (or jump to) the corresponding factory project.
  const createWorkspaceProjectsTab = useCallback((): string | null => {
    const existingTab = tabs.find(tab => tab.type === 'workspace-projects');
    if (existingTab) {
      setActiveTab(existingTab.id);
      return existingTab.id;
    }
    return addTab({
      type: 'workspace-projects',
      title: 'Projects',
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'folder',
    });
  }, [addTab, tabs, setActiveTab]);

  const createPortfolioTab = useCallback((projectPath?: string): string | null => {
    const existingTab = tabs.find(tab => tab.type === 'portfolio');
    if (existingTab) {
      if (projectPath) updateTab(existingTab.id, { projectPath });
      setActiveTab(existingTab.id);
      return existingTab.id;
    }
    return addTab({
      type: 'portfolio',
      title: 'Portfolio',
      projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'layout-grid'
    });
  }, [addTab, tabs, setActiveTab, updateTab]);

  const createPromotionTab = useCallback((projectPath?: string): string | null => {
    const existingTab = tabs.find(tab => tab.type === 'promotion');
    if (existingTab) {
      if (projectPath) updateTab(existingTab.id, { projectPath });
      setActiveTab(existingTab.id);
      return existingTab.id;
    }
    return addTab({
      type: 'promotion',
      title: 'Promotion',
      projectPath,
      status: 'idle',
      hasUnsavedChanges: false,
      icon: 'shield-check'
    });
  }, [addTab, tabs, setActiveTab, updateTab]);

  const closeTab = useCallback(async (id: string, force: boolean = false): Promise<boolean> => {
    const tab = getTabById(id);
    if (!tab) return true;

    // Check for unsaved changes
    if (!force && tab.hasUnsavedChanges) {
      // In a real implementation, you'd show a confirmation dialog here
      const confirmed = window.confirm(`Tab "${tab.title}" has unsaved changes. Close anyway?`);
      if (!confirmed) return false;
    }

    removeTab(id);
    return true;
  }, [getTabById, removeTab]);

  const closeCurrentTab = useCallback(async (): Promise<boolean> => {
    if (!activeTabId) return true;
    return closeTab(activeTabId);
  }, [activeTabId, closeTab]);

  const switchToNextTab = useCallback(() => {
    if (tabs.length === 0) return;
    
    const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
    const nextIndex = (currentIndex + 1) % tabs.length;
    setActiveTab(tabs[nextIndex].id);
  }, [tabs, activeTabId, setActiveTab]);

  const switchToPreviousTab = useCallback(() => {
    if (tabs.length === 0) return;
    
    const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
    const previousIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;
    setActiveTab(tabs[previousIndex].id);
  }, [tabs, activeTabId, setActiveTab]);

  const switchToTabByIndex = useCallback((index: number) => {
    if (index >= 0 && index < tabs.length) {
      setActiveTab(tabs[index].id);
    }
  }, [tabs, setActiveTab]);

  const updateTabTitle = useCallback((id: string, title: string) => {
    updateTab(id, { title });
  }, [updateTab]);

  const updateTabStatus = useCallback((id: string, status: Tab['status']) => {
    updateTab(id, { status });
  }, [updateTab]);

  const markTabAsChanged = useCallback((id: string, hasChanges: boolean) => {
    updateTab(id, { hasUnsavedChanges: hasChanges });
  }, [updateTab]);

  const findTabBySessionId = useCallback((sessionId: string): Tab | undefined => {
    return tabs.find(tab => tab.type === 'chat' && tab.sessionId === sessionId);
  }, [tabs]);

  const findTabByAgentRunId = useCallback((agentRunId: string): Tab | undefined => {
    return tabs.find(tab => tab.type === 'agent' && tab.agentRunId === agentRunId);
  }, [tabs]);

  const findTabByType = useCallback((type: Tab['type']): Tab | undefined => {
    return tabs.find(tab => tab.type === type);
  }, [tabs]);

  const canAddTab = useCallback((): boolean => {
    return tabs.length < 20; // MAX_TABS from context
  }, [tabs.length]);

  return {
    // State
    tabs,
    activeTab,
    activeTabId,
    tabCount,
    chatTabCount,
    agentTabCount,
    
    // Operations
    createChatTab,
    createAgentTab,
    createAgentExecutionTab,
    createProjectsTab,
    createAgentsTab,
    createUsageTab,
    createMCPTab,
    createSettingsTab,
    createClaudeMdTab,
    createSpecMarkdownTab,
    createClaudeFileTab,
    createCreateAgentTab,
    createImportAgentTab,
    createGovernanceTab,
    createXrayTab,
    createSemanticSearchTab,
    createCallGraphTab,
    createGitContextTab,
    createCheckpointTab,
    createLiveSessionsTab,
    createFactoryTab,
    createWorkspaceProjectsTab,
    createPortfolioTab,
    createPromotionTab,
    closeTab,
    closeCurrentTab,
    switchToTab: setActiveTab,
    switchToNextTab,
    switchToPreviousTab,
    switchToTabByIndex,
    updateTab,
    updateTabTitle,
    updateTabStatus,
    markTabAsChanged,
    findTabBySessionId,
    findTabByAgentRunId,
    findTabByType,
    canAddTab
  };
};