import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Plus, 
  Trash2, 
  Edit,
  Save,
  Command,
  Globe,
  FolderOpen,
  Terminal,
  FileCode,
  Zap,
  Code,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Search,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import { Button } from "@opc/ui/button";
import { Input } from "@opc/ui/input";
import { Label } from "@opc/ui/label";
import { Textarea } from "@opc/ui/textarea";
import { Card } from "@opc/ui/card";
import { Badge } from "@opc/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@opc/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@opc/ui/dialog";
import { diffLines } from "diff";
import { api, type SlashCommand } from "@/lib/api";
import { cn } from "@/lib/utils";
import { COMMON_TOOL_MATCHERS } from "@/types/hooks";
import { useTrackEvent } from "@/hooks";

interface SlashCommandsManagerProps {
  projectPath?: string;
  className?: string;
  scopeFilter?: 'project' | 'user' | 'all';
}

interface CommandForm {
  name: string;
  namespace: string;
  content: string;
  description: string;
  allowedTools: string[];
  scope: 'project' | 'user';
}

const EXAMPLE_COMMANDS = [
  {
    name: "review",
    description: "Review code for best practices",
    content: "Review the following code for best practices, potential issues, and improvements:\n\n@$ARGUMENTS",
    allowedTools: ["Read", "Grep"]
  },
  {
    name: "explain",
    description: "Explain how something works",
    content: "Explain how $ARGUMENTS works in detail, including its purpose, implementation, and usage examples.",
    allowedTools: ["Read", "Grep", "WebSearch"]
  },
  {
    name: "fix-issue",
    description: "Fix a specific issue",
    content: "Fix issue #$ARGUMENTS following our coding standards and best practices.",
    allowedTools: ["Read", "Edit", "MultiEdit", "Write"]
  },
  {
    name: "test",
    description: "Write tests for code",
    content: "Write comprehensive tests for:\n\n@$ARGUMENTS\n\nInclude unit tests, edge cases, and integration tests where appropriate.",
    allowedTools: ["Read", "Write", "Edit"]
  }
];

// Get icon for command based on its properties
const getCommandIcon = (command: SlashCommand) => {
  if (command.has_bash_commands) return Terminal;
  if (command.has_file_references) return FileCode;
  if (command.accepts_arguments) return Zap;
  if (command.scope === "project") return FolderOpen;
  if (command.scope === "user") return Globe;
  return Command;
};

interface ConflictInfo {
  conflictingIds: Set<string>;
  details: Map<string, string>;
  // For each flagged command: the content + label of the command it should be diffed against
  canonicalContent: Map<string, { content: string; label: string }>;
}

const findDuplicates = (commands: SlashCommand[]): ConflictInfo => {
  const conflictingIds = new Set<string>();
  const details = new Map<string, string>();
  const canonicalContent = new Map<string, { content: string; label: string }>();

  // Name-based conflicts: same name+namespace, different or same scope
  const byKey = new Map<string, SlashCommand[]>();
  for (const cmd of commands) {
    const key = [cmd.namespace, cmd.name].filter(Boolean).join(':');
    const group = byKey.get(key) ?? [];
    group.push(cmd);
    byKey.set(key, group);
  }
  for (const [, group] of byKey) {
    if (group.length <= 1) continue;
    const scopes = group.map(c => c.scope);
    const hasExactDuplicate = scopes.length !== new Set(scopes).size;
    if (hasExactDuplicate) {
      // Both flagged; each diffs against the first alphabetically
      const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
      const ref = sorted[0];
      for (const cmd of group) {
        conflictingIds.add(cmd.id);
        details.set(cmd.id, 'Duplicate name in same scope');
        if (cmd.id !== ref.id) {
          canonicalContent.set(cmd.id, { content: ref.content, label: ref.full_command });
        }
      }
    } else {
      // Cross-scope: project wins. Each diffs against the other.
      // Skip if we can't find both sides (e.g. one is a default-scoped command).
      const projectCmd = group.find(c => c.scope === 'project');
      const userCmd = group.find(c => c.scope === 'user');
      if (!projectCmd || !userCmd) continue;
      conflictingIds.add(projectCmd.id);
      conflictingIds.add(userCmd.id);
      details.set(userCmd.id, 'Shadowed by project scope');
      details.set(projectCmd.id, 'Shadows user command');
      canonicalContent.set(userCmd.id, { content: projectCmd.content, label: projectCmd.full_command });
      canonicalContent.set(projectCmd.id, { content: userCmd.content, label: userCmd.full_command });
    }
  }

  // Content-based duplicates: different name but identical content.
  // Flag ALL commands in the group so the user can choose which to delete,
  // rather than assuming which is the "original" via a name-length heuristic.
  const byContent = new Map<string, SlashCommand[]>();
  for (const cmd of commands) {
    const content = cmd.content.trim();
    if (!content) continue;
    const group = byContent.get(content) ?? [];
    group.push(cmd);
    byContent.set(content, group);
  }
  for (const [, group] of byContent) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort(
      (a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name)
    );
    const canonical = sorted[0];
    // Flag all commands in the group
    for (const cmd of group) {
      if (!conflictingIds.has(cmd.id)) {
        if (cmd.id === canonical.id) {
          // Canonical: list which commands duplicate it
          const others = sorted.slice(1).map(c => c.full_command).join(', ');
          details.set(cmd.id, `Duplicated by ${others}`);
          // Diff against the first copy so the user can see the comparison
          canonicalContent.set(cmd.id, { content: sorted[1].content, label: sorted[1].full_command });
        } else {
          details.set(cmd.id, `Duplicate of ${canonical.full_command}`);
          canonicalContent.set(cmd.id, { content: canonical.content, label: canonical.full_command });
        }
        conflictingIds.add(cmd.id);
      }
    }
  }

  return { conflictingIds, details, canonicalContent };
};

/**
 * SlashCommandsManager component for managing custom slash commands
 * Provides a no-code interface for creating, editing, and deleting commands
 */
export const SlashCommandsManager: React.FC<SlashCommandsManagerProps> = ({
  projectPath,
  className,
  scopeFilter = 'all',
}) => {
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedScope, setSelectedScope] = useState<'all' | 'project' | 'user' | 'conflicts'>(scopeFilter === 'all' ? 'all' : scopeFilter as 'project' | 'user');
  const [expandedCommands, setExpandedCommands] = useState<Set<string>>(new Set());
  
  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingCommand, setEditingCommand] = useState<SlashCommand | null>(null);
  const [commandForm, setCommandForm] = useState<CommandForm>({
    name: "",
    namespace: "",
    content: "",
    description: "",
    allowedTools: [],
    scope: 'user'
  });

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [commandToDelete, setCommandToDelete] = useState<SlashCommand | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Save overwrite confirmation dialog state
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  
  // Analytics tracking
  const trackEvent = useTrackEvent();

  // Detect duplicate/shadowed commands across all loaded commands (including defaults)
  const conflictInfo = useMemo(() => findDuplicates(commands), [commands]);

  // Real-time conflict check for the edit dialog
  const formConflict = useMemo(() => {
    if (!commandForm.name) return null;
    const key = [commandForm.namespace, commandForm.name].filter(Boolean).join(':');
    const matches = commands.filter(cmd => {
      if (editingCommand && cmd.id === editingCommand.id) return false;
      return [cmd.namespace, cmd.name].filter(Boolean).join(':') === key;
    });
    if (matches.length === 0) return null;
    const sameScope = matches.find(c => c.scope === commandForm.scope);
    if (sameScope) return `A ${commandForm.scope}-scoped command "${sameScope.full_command}" already exists and will be overwritten on save.`;
    const other = matches[0];
    if (commandForm.scope === 'project') return `This will shadow the user-scoped command "${other.full_command}".`;
    return `A project-scoped command "${other.full_command}" will take precedence over this.`;
  }, [commandForm.name, commandForm.namespace, commandForm.scope, commands, editingCommand]);

  // Load commands on mount
  useEffect(() => {
    loadCommands();
  }, [projectPath]);

  const loadCommands = async () => {
    try {
      setLoading(true);
      setError(null);
      const loadedCommands = await api.slashCommandsList(projectPath);
      setCommands(loadedCommands);
    } catch (err) {
      console.error("Failed to load slash commands:", err);
      setError("Failed to load commands");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNew = () => {
    setEditingCommand(null);
    setCommandForm({
      name: "",
      namespace: "",
      content: "",
      description: "",
      allowedTools: [],
      scope: scopeFilter !== 'all' ? scopeFilter : (projectPath ? 'project' : 'user')
    });
    setEditDialogOpen(true);
  };

  const handleEdit = (command: SlashCommand) => {
    setEditingCommand(command);
    setCommandForm({
      name: command.name,
      namespace: command.namespace || "",
      content: command.content,
      description: command.description || "",
      allowedTools: command.allowed_tools,
      scope: command.scope as 'project' | 'user'
    });
    setEditDialogOpen(true);
  };

  // Called from the Save button — gates on conflict confirmation when needed
  const handleSaveClick = () => {
    if (formConflict) {
      setSaveConfirmOpen(true);
    } else {
      handleSave();
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSaveConfirmOpen(false);

      // When editing, if the command identity changed (name/namespace/scope),
      // delete the old file first — otherwise the old command file is orphaned.
      if (editingCommand) {
        const identityChanged =
          commandForm.name !== editingCommand.name ||
          (commandForm.namespace || '') !== (editingCommand.namespace || '') ||
          commandForm.scope !== editingCommand.scope;
        if (identityChanged) {
          await api.slashCommandDelete(editingCommand.id, projectPath);
        }
      }

      await api.slashCommandSave(
        commandForm.scope,
        commandForm.name,
        commandForm.namespace || undefined,
        commandForm.content,
        commandForm.description || undefined,
        commandForm.allowedTools,
        commandForm.scope === 'project' ? projectPath : undefined
      );

      trackEvent.slashCommandCreated({
        command_type: 'custom',
        has_parameters: commandForm.content.includes('$ARGUMENTS')
      });

      setEditDialogOpen(false);
      await loadCommands();
    } catch (err) {
      console.error("Failed to save command:", err);
      setError(err instanceof Error ? err.message : "Failed to save command");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = (command: SlashCommand) => {
    setCommandToDelete(command);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!commandToDelete) return;

    try {
      setDeleting(true);
      setError(null);
      await api.slashCommandDelete(commandToDelete.id, projectPath);
      setDeleteDialogOpen(false);
      setCommandToDelete(null);
      await loadCommands();
    } catch (err) {
      console.error("Failed to delete command:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to delete command";
      setError(errorMessage);
    } finally {
      setDeleting(false);
    }
  };

  const cancelDelete = () => {
    setDeleteDialogOpen(false);
    setCommandToDelete(null);
  };

  const toggleExpanded = (commandId: string) => {
    setExpandedCommands(prev => {
      const next = new Set(prev);
      if (next.has(commandId)) {
        next.delete(commandId);
      } else {
        next.add(commandId);
      }
      return next;
    });
  };

  const handleToolToggle = (tool: string) => {
    setCommandForm(prev => ({
      ...prev,
      allowedTools: prev.allowedTools.includes(tool)
        ? prev.allowedTools.filter(t => t !== tool)
        : [...prev.allowedTools, tool]
    }));
  };

  const applyExample = (example: typeof EXAMPLE_COMMANDS[0]) => {
    setCommandForm(prev => ({
      ...prev,
      name: example.name,
      description: example.description,
      content: example.content,
      allowedTools: example.allowedTools
    }));
  };

  // Filter commands
  const filteredCommands = commands.filter(cmd => {
    // Hide default commands
    if (cmd.scope === 'default') {
      return false;
    }

    // Apply scopeFilter if set to specific scope
    if (scopeFilter !== 'all' && cmd.scope !== scopeFilter) {
      return false;
    }

    // Scope filter
    if (selectedScope === 'conflicts') {
      if (!conflictInfo.conflictingIds.has(cmd.id)) return false;
    } else if (selectedScope !== 'all' && cmd.scope !== selectedScope) {
      return false;
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        cmd.name.toLowerCase().includes(query) ||
        cmd.full_command.toLowerCase().includes(query) ||
        (cmd.description && cmd.description.toLowerCase().includes(query)) ||
        (cmd.namespace && cmd.namespace.toLowerCase().includes(query))
      );
    }

    return true;
  });

  // Group commands by namespace and scope
  const groupedCommands = filteredCommands.reduce((acc, cmd) => {
    const key = cmd.namespace 
      ? `${cmd.namespace} (${cmd.scope})` 
      : `${cmd.scope === 'project' ? 'Project' : 'User'} Commands`;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(cmd);
    return acc;
  }, {} as Record<string, SlashCommand[]>);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            {scopeFilter === 'project' ? 'Project Slash Commands' : 'Slash Commands'}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            {scopeFilter === 'project' 
              ? 'Create custom commands for this project' 
              : 'Create custom commands to streamline your workflow'}
          </p>
        </div>
        <Button onClick={handleCreateNew} size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          New Command
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search commands..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        {scopeFilter === 'all' && (
          <Select value={selectedScope} onValueChange={(value: any) => setSelectedScope(value)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Commands</SelectItem>
              <SelectItem value="project">Project</SelectItem>
              <SelectItem value="user">User</SelectItem>
              {conflictInfo.conflictingIds.size > 0 && (
                <SelectItem value="conflicts">
                  <span className="flex items-center gap-1.5 text-amber-600">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Conflicts ({conflictInfo.conflictingIds.size})
                  </span>
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Conflict Banner */}
      {!loading && conflictInfo.conflictingIds.size > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 text-amber-600">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm">
            {conflictInfo.conflictingIds.size} command{conflictInfo.conflictingIds.size === 1 ? '' : 's'} have conflicts (duplicate names or identical content).
          </span>
          {selectedScope !== 'conflicts' && (
            <button
              onClick={() => setSelectedScope('conflicts')}
              className="ml-auto text-xs underline underline-offset-2 hover:no-underline flex-shrink-0"
            >
              Show conflicts
            </button>
          )}
        </div>
      )}

      {/* Commands List */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredCommands.length === 0 ? (
        <Card className="p-8">
          <div className="text-center">
            <Command className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-sm text-muted-foreground">
              {searchQuery
                ? "No commands found"
                : scopeFilter === 'project'
                  ? "No project commands created yet"
                  : "No user-scoped commands"}
            </p>
            {!searchQuery && scopeFilter === 'user' && (
              <p className="text-xs text-muted-foreground/70 mt-2 max-w-md mx-auto">
                Project-scoped commands (e.g., the ones under
                <code className="px-1 mx-0.5 rounded bg-muted text-[10px]">.claude/commands/</code>
                in your repo) appear under the project tab in the scope selector above.
              </p>
            )}
            {!searchQuery && (
              <Button onClick={handleCreateNew} variant="outline" size="sm" className="mt-4">
                {scopeFilter === 'project'
                  ? "Create your first project command"
                  : "Create your first command"}
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedCommands).map(([groupKey, groupCommands]) => (
            <Card key={groupKey} className="overflow-hidden">
              <div className="p-4 bg-muted/50 border-b">
                <h4 className="text-sm font-medium">
                  {groupKey}
                </h4>
              </div>
              
              <div className="divide-y">
                {groupCommands.map((command) => {
                  const Icon = getCommandIcon(command);
                  const isExpanded = expandedCommands.has(command.id);
                  
                  return (
                    <div key={command.id}>
                      <div className="p-4">
                        <div className="flex items-start gap-4">
                          <Icon className="h-5 w-5 mt-0.5 text-muted-foreground flex-shrink-0" />
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <code className="text-sm font-mono text-primary">
                                {command.full_command}
                              </code>
                              {command.accepts_arguments && (
                                <Badge variant="secondary" className="text-xs">
                                  Arguments
                                </Badge>
                              )}
                              {conflictInfo.conflictingIds.has(command.id) && (
                                <span className="flex items-center gap-1 text-xs text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded">
                                  <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                                  {conflictInfo.details.get(command.id)}
                                </span>
                              )}
                            </div>
                            
                            {command.description && (
                              <p className="text-sm text-muted-foreground mb-2">
                                {command.description}
                              </p>
                            )}
                            
                            <div className="flex items-center gap-4 text-xs">
                              {command.allowed_tools.length > 0 && (
                                <span className="text-muted-foreground">
                                  {command.allowed_tools.length} tool{command.allowed_tools.length === 1 ? '' : 's'}
                                </span>
                              )}
                              
                              {command.has_bash_commands && (
                                <Badge variant="outline" className="text-xs">
                                  Bash
                                </Badge>
                              )}
                              
                              {command.has_file_references && (
                                <Badge variant="outline" className="text-xs">
                                  Files
                                </Badge>
                              )}
                              
                              <button
                                onClick={() => toggleExpanded(command.id)}
                                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                              >
                                {isExpanded ? (
                                  <>
                                    <ChevronDown className="h-3 w-3" />
                                    Hide content
                                  </>
                                ) : (
                                  <>
                                    <ChevronRight className="h-3 w-3" />
                                    Show content
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(command)}
                              className="h-8 w-8"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteClick(command)}
                              className="h-8 w-8 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              {(() => {
                                const ref = conflictInfo.canonicalContent.get(command.id);
                                if (!ref) {
                                  return (
                                    <div className="mt-4 p-3 bg-muted/50 rounded-md">
                                      <pre className="text-xs font-mono whitespace-pre-wrap">{command.content}</pre>
                                    </div>
                                  );
                                }
                                const chunks = diffLines(ref.content.trim(), command.content.trim());
                                const isIdentical = chunks.every(c => !c.added && !c.removed);
                                return (
                                  <div className="mt-4 rounded-md overflow-hidden border border-border">
                                    <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/70 border-b border-border text-xs text-muted-foreground">
                                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                                      {isIdentical
                                        ? <>Content is <span className="font-medium text-foreground">identical</span> to <code className="font-mono">{ref.label}</code></>
                                        : <>Comparing with <code className="font-mono">{ref.label}</code> &mdash; <span className="text-green-600 dark:text-green-400">green</span> = original only, <span className="text-red-500">red</span> = this copy only</>
                                      }
                                    </div>
                                    <pre className="text-xs font-mono">
                                      {chunks.map((chunk, i) => {
                                        const lines = chunk.value.replace(/\n$/, '').split('\n');
                                        return lines.map((line, j) => (
                                          <div
                                            key={`${i}-${j}`}
                                            className={cn(
                                              "px-3 py-px leading-5",
                                              chunk.removed && "bg-green-500/10 text-green-700 dark:text-green-400",
                                              chunk.added   && "bg-red-500/10 text-red-600 dark:text-red-400",
                                              !chunk.added && !chunk.removed && "text-muted-foreground"
                                            )}
                                          >
                                            <span className="select-none mr-2 opacity-50">
                                              {chunk.removed ? '−' : chunk.added ? '+' : ' '}
                                            </span>
                                            {line}
                                          </div>
                                        ));
                                      })}
                                    </pre>
                                  </div>
                                );
                              })()}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingCommand ? "Edit Command" : "Create New Command"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Scope */}
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select 
                value={commandForm.scope} 
                onValueChange={(value: 'project' | 'user') => setCommandForm(prev => ({ ...prev, scope: value }))}
                disabled={scopeFilter !== 'all' || (!projectPath && commandForm.scope === 'project')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(scopeFilter === 'all' || scopeFilter === 'user') && (
                    <SelectItem value="user">
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        User (Global)
                      </div>
                    </SelectItem>
                  )}
                  {(scopeFilter === 'all' || scopeFilter === 'project') && (
                    <SelectItem value="project" disabled={!projectPath}>
                      <div className="flex items-center gap-2">
                        <FolderOpen className="h-4 w-4" />
                        Project
                      </div>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {commandForm.scope === 'user' 
                  ? "Available across all projects" 
                  : "Only available in this project"}
              </p>
            </div>

            {/* Name and Namespace */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Command Name*</Label>
                <Input
                  placeholder="e.g., review, fix-issue"
                  value={commandForm.name}
                  onChange={(e) => setCommandForm(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Namespace (Optional)</Label>
                <Input
                  placeholder="e.g., frontend, backend"
                  value={commandForm.namespace}
                  onChange={(e) => setCommandForm(prev => ({ ...prev, namespace: e.target.value }))}
                />
              </div>
            </div>

            {/* Conflict warning */}
            {formConflict && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 text-amber-600">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span className="text-sm">{formConflict}</span>
              </div>
            )}

            {/* Description */}
            <div className="space-y-2">
              <Label>Description (Optional)</Label>
              <Input
                placeholder="Brief description of what this command does"
                value={commandForm.description}
                onChange={(e) => setCommandForm(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>

            {/* Content */}
            <div className="space-y-2">
              <Label>Command Content*</Label>
              <Textarea
                placeholder="Enter the prompt content. Use $ARGUMENTS for dynamic values."
                value={commandForm.content}
                onChange={(e) => setCommandForm(prev => ({ ...prev, content: e.target.value }))}
                className="min-h-[150px] font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Use <code>$ARGUMENTS</code> for user input, <code>@filename</code> for files, 
                and <code>!`command`</code> for bash commands
              </p>
            </div>

            {/* Allowed Tools */}
            <div className="space-y-2">
              <Label>Allowed Tools</Label>
              <div className="flex flex-wrap gap-2">
                {COMMON_TOOL_MATCHERS.map((tool) => (
                  <Button
                    key={tool}
                    variant={commandForm.allowedTools.includes(tool) ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleToolToggle(tool)}
                    type="button"
                  >
                    {tool}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Select which tools Claude can use with this command
              </p>
            </div>

            {/* Examples */}
            {!editingCommand && (
              <div className="space-y-2">
                <Label>Examples</Label>
                <div className="grid grid-cols-2 gap-2">
                  {EXAMPLE_COMMANDS.map((example) => (
                    <Button
                      key={example.name}
                      variant="outline"
                      size="sm"
                      onClick={() => applyExample(example)}
                      className="justify-start"
                    >
                      <Code className="h-4 w-4 mr-2" />
                      {example.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Preview */}
            {commandForm.name && (
              <div className="space-y-2">
                <Label>Preview</Label>
                <div className="p-3 bg-muted rounded-md">
                  <code className="text-sm">
                    /
                    {commandForm.namespace && `${commandForm.namespace}:`}
                    {commandForm.name}
                    {commandForm.content.includes('$ARGUMENTS') && ' [arguments]'}
                  </code>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveClick}
              disabled={!commandForm.name || !commandForm.content || saving}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save Overwrite Confirmation Dialog */}
      <Dialog open={saveConfirmOpen} onOpenChange={setSaveConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Save</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 text-amber-600">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <p className="text-sm">{formConflict}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Do you want to save anyway?
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveConfirmOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Anyway
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Command</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <p>Are you sure you want to delete this command?</p>
            {commandToDelete && (
              <div className="p-3 bg-muted rounded-md">
                <code className="text-sm font-mono">{commandToDelete.full_command}</code>
                {commandToDelete.description && (
                  <p className="text-sm text-muted-foreground mt-1">{commandToDelete.description}</p>
                )}
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              This action cannot be undone. The command file will be permanently deleted.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={cancelDelete} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}; 
