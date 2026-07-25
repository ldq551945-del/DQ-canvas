import { cn } from "@/lib/utils";

export function SiteLogo({ logoUrl, className }: { logoUrl: string; className?: string }) {
    if (logoUrl && logoUrl !== "/logo.svg") return <img src={logoUrl} alt="" className={cn("shrink-0 object-contain", className)} referrerPolicy="no-referrer" />;
    return (
        <span
            aria-hidden="true"
            className={cn("shrink-0 bg-stone-950 dark:bg-white", className)}
            style={{
                mask: "url(/logo.svg) center / contain no-repeat",
                WebkitMask: "url(/logo.svg) center / contain no-repeat",
            }}
        />
    );
}
