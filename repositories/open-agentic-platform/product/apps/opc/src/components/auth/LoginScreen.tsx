import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { GithubIcon } from '@/components/icons/GithubIcon';
import { Button } from '@opc/ui/button';
import { Card } from '@opc/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { ServerSettingsDialog } from './ServerSettingsDialog';

export function LoginScreen() {
  const { status, error, login } = useAuth();
  const isLoading = status === 'loading';
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <Card className="w-[400px] p-8 flex flex-col items-center gap-6 bg-card border-border">
          {/* Logo / branding */}
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-8 h-8 text-primary" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-foreground">Open Agentic Platform</h1>
            <p className="text-sm text-muted-foreground text-center max-w-[300px]">
              Sign in with your GitHub account to connect to your organization's workspace.
            </p>
          </div>

          {/* Login button */}
          <Button
            className="w-full gap-2"
            size="lg"
            onClick={() => login()}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Waiting for GitHub sign-in...
              </>
            ) : (
              <>
                <GithubIcon className="w-4 h-4" />
                Sign in with GitHub
              </>
            )}
          </Button>

          {/* Error display */}
          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-destructive text-center"
            >
              {error}
            </motion.p>
          )}

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          >
            Server settings
          </button>
        </Card>
      </motion.div>

      <ServerSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
