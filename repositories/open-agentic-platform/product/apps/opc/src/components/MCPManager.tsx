import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, Loader2, RefreshCw, Server } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@opc/ui/tabs";
import { Card } from "@opc/ui/card";
import { Toast, ToastContainer } from "@opc/ui/toast";
import { api, type MCPServer, type SidecarPorts } from "@/lib/api";
import { MCPServerList } from "./MCPServerList";
import { MCPAddServer } from "./MCPAddServer";
import { MCPImportExport } from "./MCPImportExport";

interface MCPManagerProps {
  /**
   * Callback to go back to the main view
   */
  onBack: () => void;
  /**
   * Optional className for styling
   */
  className?: string;
}

/**
 * Main component for managing MCP (Model Context Protocol) servers
 * Provides a comprehensive UI for adding, configuring, and managing MCP servers
 */
export const MCPManager: React.FC<MCPManagerProps> = ({
  className: _className,
}) => {
  const [activeTab, setActiveTab] = useState("servers");
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [sidecarPorts, setSidecarPorts] = useState<SidecarPorts | null>(null);
  const [sidecarLoading, setSidecarLoading] = useState(true);

  // Load servers on mount
  useEffect(() => {
    loadServers();
    void loadSidecarPorts();
  }, []);

  // Auto-poll the sidecar probe port until it announces (the sidecar
  // boots asynchronously; before this loop the user had to click Refresh
  // to see the port appear). Bounded retries with linear backoff so a
  // genuinely-degraded sidecar doesn't spin the panel forever.
  useEffect(() => {
    if (sidecarPorts?.axiomregent != null) return;
    let attempt = 0;
    const MAX_ATTEMPTS = 15; // ~30s at 2s intervals
    const interval = window.setInterval(() => {
      attempt += 1;
      if (attempt > MAX_ATTEMPTS) {
        window.clearInterval(interval);
        return;
      }
      void loadSidecarPorts();
    }, 2000);
    return () => window.clearInterval(interval);
  }, [sidecarPorts?.axiomregent]);

  const loadSidecarPorts = async () => {
    try {
      setSidecarLoading(true);
      const ports = await api.getSidecarPorts();
      setSidecarPorts(ports);
    } catch (e) {
      console.warn("MCPManager: getSidecarPorts failed", e);
      setSidecarPorts(null);
    } finally {
      setSidecarLoading(false);
    }
  };

  /**
   * Loads all MCP servers
   */
  const loadServers = async () => {
    try {
      setLoading(true);
      setError(null);
      console.log("MCPManager: Loading servers...");
      const serverList = await api.mcpList();
      console.log("MCPManager: Received server list:", serverList);
      console.log("MCPManager: Server count:", serverList.length);
      setServers(serverList);
    } catch (err) {
      console.error("MCPManager: Failed to load MCP servers:", err);
      setError("Failed to load MCP servers. Make sure Claude Code is installed.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handles server added event
   */
  const handleServerAdded = () => {
    loadServers();
    setToast({ message: "MCP server added successfully!", type: "success" });
    setActiveTab("servers");
  };

  /**
   * Handles server removed event
   */
  const handleServerRemoved = (name: string) => {
    setServers(prev => prev.filter(s => s.name !== name));
    setToast({ message: `Server "${name}" removed successfully!`, type: "success" });
  };

  /**
   * Handles import completed event
   */
  const handleImportCompleted = (imported: number, failed: number) => {
    loadServers();
    if (failed === 0) {
      setToast({ 
        message: `Successfully imported ${imported} server${imported > 1 ? 's' : ''}!`, 
        type: "success" 
      });
    } else {
      setToast({ 
        message: `Imported ${imported} server${imported > 1 ? 's' : ''}, ${failed} failed`, 
        type: "error" 
      });
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto flex flex-col h-full">
        {/* Header */}
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-heading-1">MCP Servers</h1>
              <p className="mt-1 text-body-small text-muted-foreground">
                Manage Model Context Protocol servers
              </p>
            </div>
          </div>
        </div>

        {/* Error Display */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mx-6 mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/50 flex items-center gap-2 text-body-small text-destructive"
            >
              <AlertCircle className="h-4 w-4" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Content */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            <Card className="p-4 mb-6 border-dashed">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2 min-w-0">
                  <Server className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div>
                    <div className="font-medium text-sm">OPC axiomregent (bundled sidecar)</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Governed MCP router started with the app on supported builds. Probe port is
                      announced on stderr; MCP traffic stays on stdio.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void loadSidecarPorts()}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  aria-label="Refresh axiomregent status"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${sidecarLoading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
              <div className="mt-3 text-sm">
                {sidecarLoading && !sidecarPorts ? (
                  <span className="text-muted-foreground">Checking sidecar…</span>
                ) : sidecarPorts?.axiomregent != null ? (
                  <span>
                    Probe port:{" "}
                    <span className="font-mono">{sidecarPorts.axiomregent}</span>
                  </span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">
                    No probe port yet (still starting, degraded, or unsupported target — see logs).
                  </span>
                )}
              </div>
            </Card>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="grid grid-cols-3 w-full max-w-md mb-6 h-auto p-1">
                <TabsTrigger value="servers" className="py-2.5 px-3">
                  Servers
                </TabsTrigger>
                <TabsTrigger value="add" className="py-2.5 px-3">
                  Add Server
                </TabsTrigger>
                <TabsTrigger value="import" className="py-2.5 px-3">
                  Import/Export
                </TabsTrigger>
              </TabsList>

              {/* Servers Tab */}
              <TabsContent value="servers" className="space-y-6 mt-6">
                <Card>
                  <MCPServerList
                    servers={servers}
                    loading={false}
                    onServerRemoved={handleServerRemoved}
                    onRefresh={loadServers}
                  />
                </Card>
              </TabsContent>

              {/* Add Server Tab */}
              <TabsContent value="add" className="space-y-6 mt-6">
                <Card>
                  <MCPAddServer
                    onServerAdded={handleServerAdded}
                    onError={(message: string) => setToast({ message, type: "error" })}
                  />
                </Card>
              </TabsContent>

              {/* Import/Export Tab */}
              <TabsContent value="import" className="space-y-6 mt-6">
                <Card className="overflow-hidden">
                  <MCPImportExport
                    onImportCompleted={handleImportCompleted}
                    onError={(message: string) => setToast({ message, type: "error" })}
                  />
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      {/* Toast Notifications */}
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