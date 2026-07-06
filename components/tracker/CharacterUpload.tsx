"use client";

import React, { useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { validateCharacterUpload, type CharacterUploadSchema, EXAMPLE_CHARACTER_JSON } from "@/lib/character-schema";
import { Button } from "@/components/ui/button";
import { Upload, FileJson, X, AlertTriangle, CheckCircle2, Download, BookmarkPlus } from "lucide-react";

interface CharacterUploadProps {
  onParsed: (data: CharacterUploadSchema, saveToLibrary: boolean) => void;
}

export function CharacterUpload({ onParsed }: CharacterUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [parsed, setParsed] = useState<CharacterUploadSchema | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saveToLibrary, setSaveToLibrary] = useState(true);

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith(".json")) {
      setErrors(["File must be a .json file"]);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        const result = validateCharacterUpload(data);
        setErrors(result.errors);
        setWarnings(result.warnings);
        if (result.valid) {
          setParsed(data as CharacterUploadSchema);
        } else {
          setParsed(null);
        }
      } catch {
        setErrors(["Invalid JSON — could not parse file"]);
        setParsed(null);
      }
    };
    reader.readAsText(file);
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function downloadExample() {
    const blob = new Blob([JSON.stringify(EXAMPLE_CHARACTER_JSON, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "character-template.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setParsed(null);
    setErrors([]);
    setWarnings([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      {!parsed ? (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors",
              dragging
                ? "border-primary bg-primary/10"
                : "border-border hover:border-primary/50 hover:bg-accent/30"
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileChange}
            />
            <FileJson className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium">Drop a JSON file or click to browse</p>
            <p className="text-xs text-muted-foreground mt-1">
              Must match the character schema format
            </p>
          </div>

          {errors.length > 0 && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-1">
              {errors.map((e, i) => (
                <p key={i} className="text-xs text-destructive flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 flex-none mt-0.5" /> {e}
                </p>
              ))}
            </div>
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={downloadExample}
            className="gap-1.5 text-muted-foreground w-full"
          >
            <Download className="w-3.5 h-3.5" /> Download example template
          </Button>
        </>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted p-4 space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[var(--hp-high)]" />
                <span className="font-semibold text-sm">{parsed.name}</span>
                <span className="text-xs text-muted-foreground capitalize">{parsed.type}</span>
              </div>
              <Button size="icon-sm" variant="ghost" onClick={reset} aria-label="Clear uploaded character" title="Clear">
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <span className="text-xs text-muted-foreground block">AC</span>
                <span className="font-semibold">{parsed.ac}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Max HP</span>
                <span className="font-semibold">{parsed.hpMax}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Speed</span>
                <span className="font-semibold">{parsed.speed ?? 30} ft.</span>
              </div>
            </div>

            {parsed.statBlock && (
              <div className="text-xs text-muted-foreground">
                Stat block included ·{" "}
                {[
                  parsed.statBlock.abilities?.length && `${parsed.statBlock.abilities.length} traits`,
                  parsed.statBlock.actions?.length && `${parsed.statBlock.actions.length} actions`,
                  parsed.statBlock.reactions?.length && `${parsed.statBlock.reactions.length} reactions`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}

            {warnings.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-border">
                {warnings.map((w, i) => (
                  <p key={i} className="text-xs text-[var(--hp-med)] flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 flex-none mt-0.5" /> {w}
                  </p>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={saveToLibrary}
              onChange={(e) => setSaveToLibrary(e.target.checked)}
              className="rounded border-border accent-primary"
            />
            <span className="text-sm flex items-center gap-1.5">
              <BookmarkPlus className="w-3.5 h-3.5 text-muted-foreground" />
              Save to character library for future encounters
            </span>
          </label>

          <Button className="w-full gap-1.5" onClick={() => onParsed(parsed, saveToLibrary)}>
            <Upload className="w-4 h-4" />
            Add {parsed.name} to Encounter
          </Button>
        </div>
      )}
    </div>
  );
}
