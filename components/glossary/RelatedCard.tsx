import Link from "next/link";

interface RelatedCardProps {
  href: string;
  name: string;
  type: string;
}

export function RelatedCard({ href, name, type }: RelatedCardProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card hover:border-primary/50 hover:bg-accent/30 transition-colors text-sm"
    >
      <span className="font-medium">{name}</span>
      <span className="text-xs text-muted-foreground">{type}</span>
    </Link>
  );
}
