"use client";

import { Film } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export function LazyMediaVideo({ src, label, containerClassName, videoClassName }: { src: string; label: string; containerClassName?: string; videoClassName?: string }) {
    const containerRef = useRef<HTMLSpanElement>(null);
    const [nearViewport, setNearViewport] = useState(false);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

    useEffect(() => {
        setNearViewport(false);
        setStatus("loading");
        const element = containerRef.current;
        if (!element || typeof IntersectionObserver === "undefined") {
            setNearViewport(true);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return;
                setNearViewport(true);
                observer.disconnect();
            },
            { rootMargin: "240px" },
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [src]);

    return (
        <span ref={containerRef} role="img" aria-label={label} className={cn("relative block overflow-hidden bg-muted", containerClassName)}>
            {status !== "ready" ? (
                <span className="absolute inset-0 grid place-items-center text-muted-foreground" aria-hidden="true">
                    <Film className="size-5 opacity-55" />
                </span>
            ) : null}
            {nearViewport && status !== "error" ? (
                <video
                    src={src}
                    muted
                    playsInline
                    preload="metadata"
                    aria-hidden="true"
                    className={cn("transition-[opacity,transform] duration-300", status === "ready" ? "opacity-100" : "opacity-0", videoClassName)}
                    onLoadedData={() => setStatus("ready")}
                    onError={() => setStatus("error")}
                />
            ) : null}
        </span>
    );
}
