"use client";

import { useEffect, useState } from "react";
import {
  AI_PROVIDER_OPTIONS,
  AI_SETTINGS_STORAGE_KEY,
  DEFAULT_AI_SETTINGS,
  getProviderOption,
  loadAiSettings,
  type AiProvider,
  type AiSettings,
} from "@/src/lib/ai/settings";

export function AiSettingsCard() {
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(loadAiSettings());
  }, []);

  function updateSettings(next: AiSettings) {
    setSettings(next);
    setSaved(false);
  }

  function saveSettings() {
    window.sessionStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }

  function clearSettings() {
    window.sessionStorage.removeItem(AI_SETTINGS_STORAGE_KEY);
    setSettings(DEFAULT_AI_SETTINGS);
    setSaved(false);
  }

  const selectedProvider = getProviderOption(settings.provider);

  return (
    <section className="hd-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-hood-text">AI Analyst</h2>
          <p className="mt-1 text-xs text-hood-muted">
            Optional settings for AI summaries. Your key stays in this browser
            tab&apos;s session and is sent to your HoodDesk server only when
            you run an analysis. Closing the tab clears it.
          </p>
        </div>
        {settings.apiKey ? (
          <span className="hd-badge-green">Configured</span>
        ) : (
          <span className="hd-badge-muted">Off</span>
        )}
      </div>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1.5 text-sm">
          <span className="text-hood-muted">Provider</span>
          <select
            value={settings.provider}
            onChange={(event) => {
              const provider = event.target.value as AiProvider;
              updateSettings({
                provider,
                model: getProviderOption(provider).defaultModel,
                apiKey: settings.apiKey,
              });
            }}
            className="hd-input w-full"
          >
            {AI_PROVIDER_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-hood-muted">Model</span>
          <input
            type="text"
            value={settings.model}
            onChange={(event) => updateSettings({ ...settings, model: event.target.value })}
            placeholder={selectedProvider.modelPlaceholder}
            className="hd-input w-full font-mono text-sm"
          />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-hood-muted">API Key</span>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(event) => updateSettings({ ...settings, apiKey: event.target.value })}
            placeholder="Paste your provider key"
            autoComplete="off"
            spellCheck={false}
            className="hd-input w-full font-mono text-sm"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={saveSettings} className="hd-btn-secondary">
          Save AI settings
        </button>
        <button type="button" onClick={clearSettings} className="hd-btn-ghost">
          Clear
        </button>
        {saved && (
          <span className="self-center text-xs text-hood-green">
            Saved for this tab.
          </span>
        )}
      </div>
    </section>
  );
}
