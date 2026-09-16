import React, { useState, useEffect } from "react";
import MDEditor from "@uiw/react-md-editor";
import { motion } from "framer-motion";
import { Save, Loader2 } from "lucide-react";
import { Button } from "@opc/ui/button";
import { Toast, ToastContainer } from "@opc/ui/toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface MarkdownEditorProps {
  /**
   * Callback to go back to the main view
   */
  onBack: () => void;
  /**
   * Optional className for styling
   */
  className?: string;
  /**
   * Absolute path to a markdown file in the workspace (e.g. a feature spec). When set, loads/saves this file instead of the global CLAUDE.md system prompt.
   */
  filePath?: string;
  /** Heading shown when `filePath` is set (defaults to file basename). */
  documentTitle?: string;
}

/**
 * MarkdownEditor component for editing the CLAUDE.md system prompt
 * 
 * @example
 * <MarkdownEditor onBack={() => setView('main')} />
 */
export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  className,
  filePath,
  documentTitle,
}) => {
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  
  const hasChanges = content !== originalContent;
  
  useEffect(() => {
    void loadContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when target file changes
  }, [filePath]);

  const loadContent = async () => {
    try {
      setLoading(true);
      setError(null);
      if (filePath) {
        const text = await api.readClaudeMdFile(filePath);
        setContent(text);
        setOriginalContent(text);
      } else {
        const prompt = await api.getSystemPrompt();
        setContent(prompt);
        setOriginalContent(prompt);
      }
    } catch (err) {
      console.error("Failed to load markdown:", err);
      setError(filePath ? "Failed to load file" : "Failed to load CLAUDE.md file");
    } finally {
      setLoading(false);
    }
  };
  
  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setToast(null);
      if (filePath) {
        await api.saveClaudeMdFile(filePath, content);
        setOriginalContent(content);
        setToast({ message: "File saved successfully", type: "success" });
      } else {
        await api.saveSystemPrompt(content);
        setOriginalContent(content);
        setToast({ message: "CLAUDE.md saved successfully", type: "success" });
      }
    } catch (err) {
      console.error("Failed to save markdown:", err);
      setError(filePath ? "Failed to save file" : "Failed to save CLAUDE.md file");
      setToast({ message: filePath ? "Failed to save file" : "Failed to save CLAUDE.md", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const heading = filePath
    ? documentTitle ?? filePath.split(/[/\\]/).pop() ?? "Spec"
    : "CLAUDE.md";
  const subheading = filePath
    ? filePath
    : "Edit your Claude Code system prompt";
  
  
  return (
    <div className={cn("h-full overflow-y-auto", className)}>
      <div className="max-w-6xl mx-auto flex flex-col h-full">
        {/* Header */}
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{heading}</h1>
              <p className="mt-1 text-sm text-muted-foreground font-mono break-all">
                {subheading}
              </p>
            </div>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              size="default"
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save
                </>
              )}
            </Button>
          </div>
        </div>
        
        {/* Error display */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mx-6 mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/50 text-sm text-destructive"
          >
            {error}
          </motion.div>
        )}
        
        {/* Content */}
        <div className="flex-1 overflow-hidden p-6">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="h-full rounded-lg border border-border overflow-hidden shadow-sm" data-color-mode="dark">
              <MDEditor
                value={content}
                onChange={(val) => setContent(val || "")}
                preview="edit"
                height="100%"
                visibleDragbar={false}
              />
            </div>
          )}
        </div>
      </div>
      
      {/* Toast Notification */}
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