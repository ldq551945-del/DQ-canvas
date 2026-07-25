"use client";

import type { RefObject } from "react";
import { Check } from "lucide-react";

export function WorkbenchFileInput({ inputRef, accept, onFiles }: { inputRef: RefObject<HTMLInputElement | null>; accept: string; onFiles: (files: FileList | null) => void }) {
    return (
        <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple
            className="hidden"
            onChange={(event) => {
                onFiles(event.target.files);
                event.target.value = "";
            }}
        />
    );
}

export function ResultSelectCheckbox({ selected, onSelectedChange }: { selected?: boolean; onSelectedChange?: (checked: boolean) => void }) {
    if (!onSelectedChange) return null;
    return (
        <button
            type="button"
            aria-label="选择生成结果"
            aria-pressed={Boolean(selected)}
            className={
                "absolute left-2 top-2 z-10 inline-flex size-6 items-center justify-center rounded-lg border shadow-sm backdrop-blur transition " +
                (selected
                    ? "border-stone-400 bg-white text-stone-950 shadow-stone-950/15 dark:border-white/70 dark:bg-black/45 dark:text-white dark:shadow-black/45"
                    : "border-stone-300 bg-white/70 hover:border-stone-500 dark:border-white/55 dark:bg-black/45 dark:hover:border-white")
            }
            onClick={(event) => {
                event.stopPropagation();
                onSelectedChange(!selected);
            }}
        >
            {selected ? <Check className="size-3.5 stroke-[3]" /> : null}
        </button>
    );
}
