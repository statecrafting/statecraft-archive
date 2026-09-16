import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, type ClaudeSettings } from '@/lib/api';
import { type SettingsScope, scopeKey, scopeLabel as getScopeLabel } from '@/components/ScopeSelector';

interface PermissionRule {
  id: string;
  value: string;
}

interface EnvironmentVariable {
  id: string;
  key: string;
  value: string;
}

export interface UseScopedSettingsReturn {
  settings: ClaudeSettings | null;
  loading: boolean;
  saving: boolean;
  error: string | null;

  allowRules: PermissionRule[];
  denyRules: PermissionRule[];
  envVars: EnvironmentVariable[];

  setSettings: React.Dispatch<React.SetStateAction<ClaudeSettings | null>>;
  setAllowRules: React.Dispatch<React.SetStateAction<PermissionRule[]>>;
  setDenyRules: React.Dispatch<React.SetStateAction<PermissionRule[]>>;
  setEnvVars: React.Dispatch<React.SetStateAction<EnvironmentVariable[]>>;
  updateSetting: (key: string, value: unknown) => void;

  addPermissionRule: (type: 'allow' | 'deny') => void;
  updatePermissionRule: (type: 'allow' | 'deny', id: string, value: string) => void;
  removePermissionRule: (type: 'allow' | 'deny', id: string) => void;

  addEnvVar: () => void;
  updateEnvVar: (id: string, field: 'key' | 'value', value: string) => void;
  removeEnvVar: (id: string) => void;

  saveSettings: () => Promise<void>;
  liveSettings: ClaudeSettings;
  scopeLabel: string;
}

export function useScopedSettings(scope: SettingsScope): UseScopedSettingsReturn {
  const [settings, setSettings] = useState<ClaudeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [allowRules, setAllowRules] = useState<PermissionRule[]>([]);
  const [denyRules, setDenyRules] = useState<PermissionRule[]>([]);
  const [envVars, setEnvVars] = useState<EnvironmentVariable[]>([]);

  // Stable key so we reload when scope identity changes
  const currentScopeKey = scopeKey(scope);

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let loaded: ClaudeSettings;
      if (scope.type === 'user') {
        loaded = await api.getClaudeSettings();
      } else {
        loaded = await api.getScopedSettings(scope.type, scope.projectPath) as ClaudeSettings;
      }

      if (!loaded || typeof loaded !== 'object') {
        loaded = {};
      }

      setSettings(loaded);

      // Parse permissions
      const perms = (loaded as any)?.permissions;
      if (perms && typeof perms === 'object') {
        setAllowRules(
          Array.isArray(perms.allow)
            ? perms.allow.map((r: string, i: number) => ({ id: `allow-${i}`, value: r }))
            : []
        );
        setDenyRules(
          Array.isArray(perms.deny)
            ? perms.deny.map((r: string, i: number) => ({ id: `deny-${i}`, value: r }))
            : []
        );
      } else {
        setAllowRules([]);
        setDenyRules([]);
      }

      // Parse env vars
      const env = (loaded as any)?.env;
      if (env && typeof env === 'object' && !Array.isArray(env)) {
        setEnvVars(
          Object.entries(env).map(([key, value], i) => ({
            id: `env-${i}`,
            key,
            value: value as string,
          }))
        );
      } else {
        setEnvVars([]);
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
      setError('Failed to load settings.');
      setSettings({});
    } finally {
      setLoading(false);
    }
  }, [currentScopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Mutations
  const updateSetting = useCallback((key: string, value: unknown) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const addPermissionRule = useCallback((type: 'allow' | 'deny') => {
    const rule: PermissionRule = { id: `${type}-${Date.now()}`, value: '' };
    (type === 'allow' ? setAllowRules : setDenyRules)(prev => [...prev, rule]);
  }, []);

  const updatePermissionRule = useCallback((type: 'allow' | 'deny', id: string, value: string) => {
    const setter = type === 'allow' ? setAllowRules : setDenyRules;
    setter(prev => prev.map(r => (r.id === id ? { ...r, value } : r)));
  }, []);

  const removePermissionRule = useCallback((type: 'allow' | 'deny', id: string) => {
    const setter = type === 'allow' ? setAllowRules : setDenyRules;
    setter(prev => prev.filter(r => r.id !== id));
  }, []);

  const addEnvVar = useCallback(() => {
    setEnvVars(prev => [...prev, { id: `env-${Date.now()}`, key: '', value: '' }]);
  }, []);

  const updateEnvVar = useCallback((id: string, field: 'key' | 'value', value: string) => {
    setEnvVars(prev => prev.map(v => (v.id === id ? { ...v, [field]: value } : v)));
  }, []);

  const removeEnvVar = useCallback((id: string) => {
    setEnvVars(prev => prev.filter(v => v.id !== id));
  }, []);

  // Build the live preview object
  const liveSettings = useMemo<ClaudeSettings>(() => ({
    ...settings,
    permissions: {
      allow: allowRules.map(r => r.value).filter(v => v && String(v).trim()),
      deny: denyRules.map(r => r.value).filter(v => v && String(v).trim()),
    },
    env: envVars.reduce((acc, { key, value }) => {
      if (key && String(key).trim() && value && String(value).trim()) {
        acc[key] = String(value);
      }
      return acc;
    }, {} as Record<string, string>),
  }), [settings, allowRules, denyRules, envVars]);

  // Save
  const saveSettings = useCallback(async () => {
    try {
      setSaving(true);
      setError(null);

      const updated: ClaudeSettings = {
        ...settings,
        permissions: {
          allow: allowRules.map(r => r.value).filter(v => v && String(v).trim()),
          deny: denyRules.map(r => r.value).filter(v => v && String(v).trim()),
        },
        env: envVars.reduce((acc, { key, value }) => {
          if (key && String(key).trim() && value && String(value).trim()) {
            acc[key] = String(value);
          }
          return acc;
        }, {} as Record<string, string>),
      };

      if (scope.type === 'user') {
        await api.saveClaudeSettings(updated);
      } else {
        await api.saveScopedSettings(scope.type, updated, scope.projectPath);
      }

      setSettings(updated);
    } catch (err) {
      console.error('Failed to save settings:', err);
      setError('Failed to save settings.');
      throw err;
    } finally {
      setSaving(false);
    }
  }, [settings, allowRules, denyRules, envVars, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    settings,
    loading,
    saving,
    error,
    allowRules,
    denyRules,
    envVars,
    setSettings,
    setAllowRules,
    setDenyRules,
    setEnvVars,
    updateSetting,
    addPermissionRule,
    updatePermissionRule,
    removePermissionRule,
    addEnvVar,
    updateEnvVar,
    removeEnvVar,
    saveSettings,
    liveSettings,
    scopeLabel: getScopeLabel(scope),
  };
}
