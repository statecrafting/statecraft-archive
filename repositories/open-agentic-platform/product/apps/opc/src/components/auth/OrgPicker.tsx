import { useState } from 'react';
import { motion } from 'framer-motion';
import { Building2, Loader2 } from 'lucide-react';
import { Card } from '@opc/ui/card';
import { useAuth, type AuthOrg } from '@/contexts/AuthContext';

export function OrgPicker() {
  const { user, pendingOrgs, selectOrg, error, status } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isLoading = status === 'loading';

  const handleSelect = async (org: AuthOrg) => {
    setSelectedId(org.org_id);
    await selectOrg(org.org_id);
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-[440px]"
      >
        <div className="flex flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">Select your organization</h1>
            {user && (
              <p className="text-sm text-muted-foreground">
                Signed in as <span className="font-medium text-foreground">{user.github_login}</span>
              </p>
            )}
          </div>

          <div className="w-full flex flex-col gap-2">
            {pendingOrgs?.map((org) => (
              <Card
                key={org.org_id}
                className={`p-4 cursor-pointer transition-colors hover:bg-accent/50 border-border
                  ${selectedId === org.org_id ? 'ring-2 ring-primary' : ''}`}
                onClick={() => !isLoading && handleSelect(org)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{org.github_org_login}</p>
                    <p className="text-xs text-muted-foreground capitalize">{org.platform_role}</p>
                  </div>
                  {isLoading && selectedId === org.org_id && (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              </Card>
            ))}
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-destructive text-center"
            >
              {error}
            </motion.p>
          )}
        </div>
      </motion.div>
    </div>
  );
}
