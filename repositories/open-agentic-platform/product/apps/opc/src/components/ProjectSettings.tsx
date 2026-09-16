/**
 * ProjectSettings component for managing project-specific configuration
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { HooksEditor } from '@/components/HooksEditor';
import { SlashCommandsManager } from '@/components/SlashCommandsManager';
import { api } from '@/lib/api';
import {
  AlertTriangle,
  ArrowLeft,
  Settings,
  FolderOpen,
  GitBranch,
  Shield,
  Command,
  Plus,
  Trash2,
  Save,
  Loader2,
  Eye,
} from 'lucide-react';
import { Button } from '@opc/ui/button';
import { Input } from '@opc/ui/input';
import { Label } from '@opc/ui/label';
import { Card } from '@opc/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@opc/ui/tabs';
import { cn } from '@/lib/utils';
import { Toast, ToastContainer } from '@opc/ui/toast';
import type { Project } from '@/lib/api';

interface ProjectSettingsProps {
  project: Project;
  onBack: () => void;
  className?: string;
}

interface PermissionRule {
  id: string;
  value: string;
}

const DEFAULT_MODES = [
  { value: 'normal', label: 'Normal — ask for approval' },
  { value: 'acceptEdits', label: 'Accept Edits — auto-approve file changes' },
  { value: 'bypassPermissions', label: 'Bypass — approve all tools (use with caution)' },
];

export const ProjectSettings: React.FC<ProjectSettingsProps> = ({
  project,
  onBack,
  className
}) => {
  const [activeTab, setActiveTab] = useState('permissions');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Gitignore check
  const [gitIgnoreLocal, setGitIgnoreLocal] = useState(true);

  // Permissions state (project scope)
  const [allowRules, setAllowRules] = useState<PermissionRule[]>([]);
  const [denyRules, setDenyRules] = useState<PermissionRule[]>([]);
  const [defaultMode, setDefaultMode] = useState<string>('normal');
  const [permissionsLoading, setPermissionsLoading] = useState(true);
  const [permissionsSaving, setPermissionsSaving] = useState(false);

  // Effective merged config
  const [mergedSettings, setMergedSettings] = useState<Record<string, unknown> | null>(null);
  const [showMerged, setShowMerged] = useState(false);

  useEffect(() => {
    checkGitIgnore();
    loadProjectPermissions();
  }, [project]);

  const checkGitIgnore = async () => {
    try {
      const gitignorePath = `${project.path}/.gitignore`;
      const gitignoreContent = await api.readClaudeMdFile(gitignorePath);
      setGitIgnoreLocal(gitignoreContent.includes('.claude/settings.local.json'));
    } catch {
      setGitIgnoreLocal(false);
    }
  };

  const addToGitIgnore = async () => {
    try {
      const gitignorePath = `${project.path}/.gitignore`;
      let content = '';

      try {
        content = await api.readClaudeMdFile(gitignorePath);
      } catch {
        // File doesn't exist, create it
      }

      if (!content.includes('.claude/settings.local.json')) {
        content += '\n# Claude local settings (machine-specific)\n.claude/settings.local.json\n';
        await api.saveClaudeMdFile(gitignorePath, content);
        setGitIgnoreLocal(true);
        setToast({ message: 'Added to .gitignore', type: 'success' });
      }
    } catch (err) {
      console.error('Failed to update .gitignore:', err);
      setToast({ message: 'Failed to update .gitignore', type: 'error' });
    }
  };

  const loadProjectPermissions = useCallback(async () => {
    setPermissionsLoading(true);
    try {
      const settings = await api.getScopedSettings('project', project.path);
      const perms = (settings as any)?.permissions ?? {};

      setAllowRules(
        (perms.allow ?? []).map((v: string, i: number) => ({ id: `allow-${i}`, value: v }))
      );
      setDenyRules(
        (perms.deny ?? []).map((v: string, i: number) => ({ id: `deny-${i}`, value: v }))
      );
      setDefaultMode(perms.defaultMode ?? 'normal');
    } catch (err) {
      console.error('Failed to load project permissions:', err);
      setToast({ message: 'Failed to load project permissions', type: 'error' });
    } finally {
      setPermissionsLoading(false);
    }
  }, [project.path]);

  const saveProjectPermissions = async () => {
    setPermissionsSaving(true);
    try {
      // Read current settings to preserve other keys (hooks, env, etc.)
      const current = await api.getScopedSettings('project', project.path);

      const updated = {
        ...current,
        permissions: {
          allow: allowRules.map(r => r.value).filter(v => v && v.trim()),
          deny: denyRules.map(r => r.value).filter(v => v && v.trim()),
          ...(defaultMode !== 'normal' ? { defaultMode } : {}),
        },
      };

      await api.saveScopedSettings('project', updated, project.path);
      setToast({ message: 'Project permissions saved', type: 'success' });
    } catch (err) {
      console.error('Failed to save project permissions:', err);
      setToast({ message: 'Failed to save permissions', type: 'error' });
    } finally {
      setPermissionsSaving(false);
    }
  };

  const loadMergedSettings = async () => {
    try {
      const merged = await api.getMergedSettings(project.path);
      setMergedSettings(merged);
      setShowMerged(true);
    } catch (err) {
      console.error('Failed to load merged settings:', err);
      setToast({ message: 'Failed to load effective config', type: 'error' });
    }
  };

  const addPermissionRule = (type: 'allow' | 'deny') => {
    const newRule: PermissionRule = { id: `${type}-${Date.now()}`, value: '' };
    if (type === 'allow') {
      setAllowRules(prev => [...prev, newRule]);
    } else {
      setDenyRules(prev => [...prev, newRule]);
    }
  };

  const updatePermissionRule = (type: 'allow' | 'deny', id: string, value: string) => {
    const setter = type === 'allow' ? setAllowRules : setDenyRules;
    setter(prev => prev.map(rule => (rule.id === id ? { ...rule, value } : rule)));
  };

  const removePermissionRule = (type: 'allow' | 'deny', id: string) => {
    const setter = type === 'allow' ? setAllowRules : setDenyRules;
    setter(prev => prev.filter(rule => rule.id !== id));
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-xl font-semibold">Project Settings</h2>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4" />
            <span className="font-mono">{project.path}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="mb-6">
              <TabsTrigger value="permissions" className="gap-2">
                <Shield className="h-4 w-4" />
                Permissions
              </TabsTrigger>
              <TabsTrigger value="commands" className="gap-2">
                <Command className="h-4 w-4" />
                Slash Commands
              </TabsTrigger>
              <TabsTrigger value="project" className="gap-2">
                <GitBranch className="h-4 w-4" />
                Project Hooks
              </TabsTrigger>
              <TabsTrigger value="local" className="gap-2">
                <Settings className="h-4 w-4" />
                Local Hooks
              </TabsTrigger>
            </TabsList>

            {/* Permissions Tab */}
            <TabsContent value="permissions" className="space-y-6">
              <Card className="p-6">
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold mb-1">Project Permission Rules</h3>
                      <p className="text-sm text-muted-foreground">
                        Shared permissions for all team members. Stored in
                        <code className="mx-1 px-2 py-1 bg-muted rounded text-xs">.claude/settings.json</code>
                      </p>
                    </div>
                    <Button
                      onClick={saveProjectPermissions}
                      disabled={permissionsSaving}
                      className="gap-2"
                    >
                      {permissionsSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      Save
                    </Button>
                  </div>

                  {permissionsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <>
                      {/* Default Mode */}
                      <div className="space-y-2">
                        <Label>Default Mode</Label>
                        <select
                          value={defaultMode}
                          onChange={(e) => setDefaultMode(e.target.value)}
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        >
                          {DEFAULT_MODES.map((mode) => (
                            <option key={mode.value} value={mode.value}>
                              {mode.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Allow Rules */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-green-500">Allow Rules</Label>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => addPermissionRule('allow')}
                            className="gap-2 hover:border-green-500/50 hover:text-green-500"
                          >
                            <Plus className="h-3 w-3" />
                            Add Rule
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {allowRules.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2">
                              No allow rules configured.
                            </p>
                          ) : (
                            allowRules.map((rule) => (
                              <motion.div
                                key={rule.id}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.15 }}
                                className="flex items-center gap-2"
                              >
                                <Input
                                  placeholder="e.g., Bash(npm run test:*)"
                                  value={rule.value}
                                  onChange={(e) => updatePermissionRule('allow', rule.id, e.target.value)}
                                  className="flex-1"
                                />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removePermissionRule('allow', rule.id)}
                                  className="h-8 w-8"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </motion.div>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Deny Rules */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-red-500">Deny Rules</Label>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => addPermissionRule('deny')}
                            className="gap-2 hover:border-red-500/50 hover:text-red-500"
                          >
                            <Plus className="h-3 w-3" />
                            Add Rule
                          </Button>
                        </div>
                        <div className="space-y-2">
                          {denyRules.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2">
                              No deny rules configured.
                            </p>
                          ) : (
                            denyRules.map((rule) => (
                              <motion.div
                                key={rule.id}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.15 }}
                                className="flex items-center gap-2"
                              >
                                <Input
                                  placeholder="e.g., Bash(curl:*)"
                                  value={rule.value}
                                  onChange={(e) => updatePermissionRule('deny', rule.id, e.target.value)}
                                  className="flex-1"
                                />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removePermissionRule('deny', rule.id)}
                                  className="h-8 w-8"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </motion.div>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Examples */}
                      <div className="pt-2 space-y-2">
                        <p className="text-xs text-muted-foreground">
                          <strong>Examples:</strong>
                        </p>
                        <ul className="text-xs text-muted-foreground space-y-1 ml-4">
                          <li>• <code className="px-1 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400">Bash(*)</code> — Allow all bash commands</li>
                          <li>• <code className="px-1 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400">Bash(npm run test:*)</code> — Allow commands with prefix</li>
                          <li>• <code className="px-1 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400">Read(**)</code> — Allow reading all files</li>
                          <li>• <code className="px-1 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400">Edit(src/**)</code> — Allow editing files in src/</li>
                        </ul>
                      </div>
                    </>
                  )}
                </div>
              </Card>

              {/* Effective (Merged) Config */}
              <Card className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold mb-1">Effective Configuration</h3>
                      <p className="text-sm text-muted-foreground">
                        Merged result of user + project + local settings (what Claude Code sees at runtime)
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadMergedSettings}
                      className="gap-2"
                    >
                      <Eye className="h-4 w-4" />
                      {showMerged ? 'Refresh' : 'Show'}
                    </Button>
                  </div>

                  {showMerged && mergedSettings && (
                    <pre className="p-4 bg-muted rounded-md text-xs overflow-auto max-h-64 font-mono">
                      {JSON.stringify(mergedSettings, null, 2)}
                    </pre>
                  )}
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="commands" className="space-y-6">
              <Card className="p-6">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold mb-2">Project Slash Commands</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Custom commands that are specific to this project. These commands are stored in
                      <code className="mx-1 px-2 py-1 bg-muted rounded text-xs">.claude/slash-commands/</code>
                      and can be committed to version control.
                    </p>
                  </div>

                  <SlashCommandsManager
                    projectPath={project.path}
                    scopeFilter="project"
                  />
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="project" className="space-y-6">
              <Card className="p-6">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold mb-2">Project Hooks</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      These hooks apply to all users working on this project. They are stored in
                      <code className="mx-1 px-2 py-1 bg-muted rounded text-xs">.claude/settings.json</code>
                      and should be committed to version control.
                    </p>
                  </div>

                  <HooksEditor
                    projectPath={project.path}
                    scope="project"
                  />
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="local" className="space-y-6">
              <Card className="p-6">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold mb-2">Local Hooks</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      These hooks only apply to your machine. They are stored in
                      <code className="mx-1 px-2 py-1 bg-muted rounded text-xs">.claude/settings.local.json</code>
                      and should NOT be committed to version control.
                    </p>

                    {!gitIgnoreLocal && (
                      <div className="flex items-center gap-4 p-3 bg-yellow-500/10 rounded-md">
                        <AlertTriangle className="h-5 w-5 text-yellow-600" />
                        <div className="flex-1">
                          <p className="text-sm text-yellow-600">
                            Local settings file is not in .gitignore
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={addToGitIgnore}
                        >
                          Add to .gitignore
                        </Button>
                      </div>
                    )}
                  </div>

                  <HooksEditor
                    projectPath={project.path}
                    scope="local"
                  />
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Toast Container */}
      <ToastContainer>
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onDismiss={() => setToast(null)}
          />
        )}
      </ToastContainer>
    </div>
  );
};
