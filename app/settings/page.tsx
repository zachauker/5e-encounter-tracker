"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Eye, EyeOff, Check, Loader2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const router = useRouter();
  const [cobaltToken, setCobaltToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<"unconfigured" | "configured">("unconfigured");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setCampaignName(data.campaign_name ?? "");
        setTokenStatus(data.ddb_cobalt_token === "configured" ? "configured" : "unconfigured");
      });
  }, []);

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, string> = { campaign_name: campaignName };
      if (cobaltToken.trim()) body.ddb_cobalt_token = cobaltToken.trim();
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setSaved(true);
      if (cobaltToken.trim()) setTokenStatus("configured");
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function testDDB() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/ddb/characters");
      const data = await res.json();
      if (data.characters?.length > 0) {
        setTestResult(`✓ Connected — found ${data.characters.length} character(s)`);
      } else if (data.error) {
        setTestResult(`✗ ${data.error}`);
      } else {
        setTestResult("✓ Connected (no characters found)");
      }
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center gap-3">
          <Button size="icon-sm" variant="ghost" onClick={() => router.push("/")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="font-bold text-lg">Settings</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* General */}
        <section className="rounded-xl border border-border bg-card p-6 space-y-4">
          <h2 className="font-semibold">General</h2>
          <div>
            <label className="text-sm text-muted-foreground block mb-1.5">Campaign Name</label>
            <Input
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="My Campaign"
            />
          </div>
        </section>

        {/* D&D Beyond */}
        <section className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-semibold">D&D Beyond Integration</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Connect your D&D Beyond account to import character sheets.
              </p>
            </div>
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-xs border",
                tokenStatus === "configured"
                  ? "text-[var(--hp-high)] border-[var(--hp-high)]/40 bg-[var(--hp-high)]/10"
                  : "text-muted-foreground border-border"
              )}
            >
              {tokenStatus === "configured" ? "Connected" : "Not configured"}
            </span>
          </div>

          <div className="bg-muted rounded-lg p-4 text-sm space-y-2 border border-border">
            <p className="font-medium text-sm">How to get your Cobalt token:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-xs">
              <li>Log into D&D Beyond in your browser</li>
              <li>Open DevTools (F12 or Cmd+Option+I)</li>
              <li>Go to Application → Cookies → dndbeyond.com</li>
              <li>Find the <code className="bg-background px-1 rounded">CobaltSession</code> cookie</li>
              <li>Copy its value and paste it below</li>
            </ol>
          </div>

          <div>
            <label className="text-sm text-muted-foreground block mb-1.5">Cobalt Session Token</label>
            <div className="relative">
              <Input
                type={showToken ? "text" : "password"}
                value={cobaltToken}
                onChange={(e) => setCobaltToken(e.target.value)}
                placeholder={tokenStatus === "configured" ? "••••••• (already set)" : "Paste token here..."}
                className="pr-10"
              />
              <button
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {tokenStatus === "configured" && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={testDDB}
                disabled={testing}
                className="gap-1.5"
              >
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Test Connection
              </Button>
              {testResult && (
                <span
                  className={cn(
                    "text-sm",
                    testResult.startsWith("✓") ? "text-[var(--hp-high)]" : "text-destructive"
                  )}
                >
                  {testResult}
                </span>
              )}
            </div>
          )}
        </section>

        <Button onClick={save} disabled={saving} className="gap-1.5 w-full">
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : saved ? (
            <Check className="w-4 h-4" />
          ) : null}
          {saved ? "Saved!" : saving ? "Saving..." : "Save Settings"}
        </Button>
      </main>
    </div>
  );
}
