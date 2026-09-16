// OPC custom window titlebar — desktop shell surface.
//
// Spec 180 (opc-shell-codification) owns this file via its broad
// `src/components` shell authority; the centre version banner is pure shell
// identity. Spec 183 (opc-boot-precondition-gate) FR-T3 owns the invariant
// that the right-side cockpit-nav cluster MUST NOT be presented during boot,
// implemented here via the `navEnabled` prop (App passes `bootGateOpen`).
// See spec 180 §2.2 and spec 183 §3.3.
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Settings, Minus, Square, X, Bot, BarChart3, Network, Factory, FolderKanban } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getVersion } from '@tauri-apps/api/app';
import { TooltipProvider, TooltipSimple } from '@opc/ui/tooltip-modern';

interface CustomTitlebarProps {
  onSettingsClick?: () => void;
  onAgentsClick?: () => void;
  onUsageClick?: () => void;
  onMCPClick?: () => void;
  onFactoryClick?: () => void;
  onWorkspaceProjectsClick?: () => void;
  /**
   * Spec 183 FR-T3 — the right-side navigation cluster targets cockpit
   * surfaces (tabs, settings, factory, usage). Those are NOT boot-state
   * affordances, so the cluster MUST stay absent until the boot gate
   * green-lights the cockpit. App passes `bootGateOpen` here; defaults to
   * `false` so any caller that omits it fails safe toward "hidden".
   */
  navEnabled?: boolean;
}

export const CustomTitlebar: React.FC<CustomTitlebarProps> = ({
  onSettingsClick,
  onAgentsClick,
  onUsageClick,
  onMCPClick,
  onFactoryClick,
  onWorkspaceProjectsClick,
  navEnabled = false,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  // Spec 180 — shell identity. Resolve the OPC version from tauri.conf.json
  // (the single source of truth, currently 0.4.0) via the Tauri app API.
  // Web-mode (no Tauri runtime) leaves it blank — the banner degrades to
  // "OPC" rather than throwing.
  const [version, setVersion] = useState<string>('');
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__ && !window.__TAURI__) return;
    void getVersion().then(setVersion).catch(() => setVersion(''));
  }, []);

  const handleMinimize = async () => {
    try {
      const window = getCurrentWindow();
      await window.minimize();
      console.log('Window minimized successfully');
    } catch (error) {
      console.error('Failed to minimize window:', error);
    }
  };

  const handleMaximize = async () => {
    try {
      const window = getCurrentWindow();
      const isMaximized = await window.isMaximized();
      if (isMaximized) {
        await window.unmaximize();
        console.log('Window unmaximized successfully');
      } else {
        await window.maximize();
        console.log('Window maximized successfully');
      }
    } catch (error) {
      console.error('Failed to maximize/unmaximize window:', error);
    }
  };

  const handleClose = async () => {
    try {
      const window = getCurrentWindow();
      await window.close();
      console.log('Window closed successfully');
    } catch (error) {
      console.error('Failed to close window:', error);
    }
  };

  return (
    <TooltipProvider>
    <div 
      className="relative z-[200] h-11 bg-background/95 backdrop-blur-sm flex items-center justify-between select-none border-b border-border/50 tauri-drag"
      data-tauri-drag-region
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Left side - macOS Traffic Light buttons */}
      <div className="flex items-center space-x-2 pl-5">
        <div className="flex items-center space-x-2">
          {/* Close button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleClose();
            }}
            className="group relative w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 transition-all duration-200 flex items-center justify-center tauri-no-drag"
            title="Close"
          >
            {isHovered && (
              <X size={8} className="text-red-900 opacity-60 group-hover:opacity-100" />
            )}
          </button>

          {/* Minimize button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleMinimize();
            }}
            className="group relative w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-all duration-200 flex items-center justify-center tauri-no-drag"
            title="Minimize"
          >
            {isHovered && (
              <Minus size={8} className="text-yellow-900 opacity-60 group-hover:opacity-100" />
            )}
          </button>

          {/* Maximize button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleMaximize();
            }}
            className="group relative w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 transition-all duration-200 flex items-center justify-center tauri-no-drag"
            title="Maximize"
          >
            {isHovered && (
              <Square size={6} className="text-green-900 opacity-60 group-hover:opacity-100" />
            )}
          </button>
        </div>
      </div>

      {/* Center - OPC version banner (spec 180 shell identity). Absolutely
          centred and pointer-events-none so it never blocks window drag. */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        data-tauri-drag-region
      >
        <span className="text-xs font-medium text-muted-foreground/80 tabular-nums">
          {version ? `OPC v${version}` : 'OPC'}
        </span>
      </div>

      {/* Right side - Navigation icons. Spec 183 FR-T3: these target cockpit
          surfaces (tabs/settings/factory/usage), which are NOT boot-state
          affordances — so the whole cluster is hidden until App reports the
          boot gate has green-lit the cockpit (navEnabled = bootGateOpen). */}
      {navEnabled && (
      <div className="flex items-center pr-5 gap-1 tauri-no-drag">
        {onAgentsClick && (
          <TooltipSimple content="Agents" side="bottom">
            <motion.button
              onClick={onAgentsClick}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors tauri-no-drag"
            >
              <Bot size={16} />
            </motion.button>
          </TooltipSimple>
        )}

        {onWorkspaceProjectsClick && (
          <TooltipSimple content="Workspace Projects" side="bottom">
            <motion.button
              onClick={onWorkspaceProjectsClick}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors tauri-no-drag"
            >
              <FolderKanban size={16} />
            </motion.button>
          </TooltipSimple>
        )}

        {onFactoryClick && (
          <TooltipSimple content="Factory" side="bottom">
            <motion.button
              onClick={onFactoryClick}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors tauri-no-drag"
            >
              <Factory size={16} />
            </motion.button>
          </TooltipSimple>
        )}

        {onUsageClick && (
          <TooltipSimple content="Usage Dashboard" side="bottom">
            <motion.button
              onClick={onUsageClick}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors tauri-no-drag"
            >
              <BarChart3 size={16} />
            </motion.button>
          </TooltipSimple>
        )}

        {/* Visual separator */}
        <div className="w-px h-5 bg-border/50 mx-1" />

        {onMCPClick && (
          <TooltipSimple content="MCP Servers" side="bottom">
            <motion.button
              onClick={onMCPClick}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors tauri-no-drag"
            >
              <Network size={16} />
            </motion.button>
          </TooltipSimple>
        )}

        {onSettingsClick && (
          <TooltipSimple content="Settings" side="bottom">
            <motion.button
              onClick={onSettingsClick}
              whileTap={{ scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors tauri-no-drag"
            >
              <Settings size={16} />
            </motion.button>
          </TooltipSimple>
        )}
      </div>
      )}
    </div>
    </TooltipProvider>
  );
};
