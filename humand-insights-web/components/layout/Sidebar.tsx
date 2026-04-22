"use client";

import {
  BarChart3,
  BookOpen,
  Bot,
  GitCompare,
  Globe2,
  HeartCrack,
  HelpCircle,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Megaphone,
  Package,
  Puzzle,
  Target,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type Item = {
  href: string;
  label: string;
  section: string;
  icon: LucideIcon;
  roles?: string[];
};

const ITEMS: Item[] = [
  { href: "/executive-summary", label: "Executive Summary", section: "Dashboards", icon: LayoutDashboard },
  { href: "/product-intelligence", label: "Product Intelligence", section: "Dashboards", icon: Package },
  { href: "/competitive-intelligence", label: "Competitive Intel", section: "Dashboards", icon: Target },
  { href: "/sales-enablement", label: "Sales Enablement", section: "Dashboards", icon: Users },
  { href: "/regional-gtm", label: "Regional / GTM", section: "Dashboards", icon: Globe2 },
  { href: "/pains-detail", label: "Pains", section: "Detalle", icon: HeartCrack },
  { href: "/product-gaps-detail", label: "Product Gaps", section: "Detalle", icon: Puzzle },
  { href: "/faq-detail", label: "FAQs", section: "Detalle", icon: HelpCircle },
  { href: "/comparative-analysis", label: "Comparative Analysis", section: "Herramientas", icon: GitCompare },
  { href: "/custom-dashboards", label: "Custom Dashboards", section: "Herramientas", icon: LayoutGrid },
  { href: "/sql-chat", label: "Chat con IA", section: "Herramientas", icon: Bot },
  { href: "/glossary", label: "Glosario", section: "Herramientas", icon: BookOpen },
  { href: "/campaign-advisor", label: "Campaign Advisor", section: "Marketing", icon: Megaphone, roles: ["admin", "campaign_advisor"] },
];

type Props = {
  roles: string[];
  userEmail?: string | null;
};

export function Sidebar({ roles, userEmail }: Props) {
  const pathname = usePathname();
  const available = ITEMS.filter((item) => {
    if (!item.roles) return true;
    return item.roles.some((role) => roles.includes(role));
  });
  const sections = Array.from(new Set(available.map((item) => item.section)));

  const initials = (userEmail ?? "?")
    .split("@")[0]
    .split(/[._-]/)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");

  return (
    <aside className="sticky top-0 flex h-screen w-[248px] shrink-0 flex-col border-r border-[var(--color-neutral-200)] bg-[var(--color-bg-card)]">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-[var(--color-brand-400)] to-[var(--color-brand-500)] text-white shadow-[var(--shadow-4dp)]">
          <BarChart3 size={18} strokeWidth={2.5} />
        </div>
        <div className="leading-tight">
          <div className="text-[14px] font-semibold tracking-tight text-[var(--color-text-default)]">
            Humand Insights
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            AI Dashboard
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {sections.map((section, idx) => (
          <div key={section} className={cn("space-y-0.5", idx > 0 && "mt-4")}>
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-secondary)]">
              {section}
            </p>
            {available
              .filter((item) => item.section === section)
              .map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-[8px] px-3 py-2 text-[13px] font-medium transition-all",
                      active
                        ? "bg-[var(--color-brand-50)] text-[var(--color-brand-500)]"
                        : "text-[var(--color-text-default)] hover:bg-[var(--color-neutral-100)] hover:text-[var(--color-text-default)]",
                    )}
                  >
                    {active ? (
                      <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-r-full bg-[var(--color-brand-500)]" />
                    ) : null}
                    <Icon
                      size={16}
                      strokeWidth={active ? 2.25 : 1.75}
                      className={cn(
                        "shrink-0 transition-transform group-hover:scale-105",
                        active
                          ? "text-[var(--color-brand-500)]"
                          : "text-[var(--color-text-secondary)]",
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="border-t border-[var(--color-neutral-100)] px-3 py-3">
        <div className="flex items-center gap-2.5 rounded-[8px] px-2 py-1.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-100)] text-[11px] font-semibold text-[var(--color-brand-500)]">
            {initials || "·"}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[12px] font-semibold text-[var(--color-text-default)]">
              {userEmail?.split("@")[0] ?? "Invitado"}
            </div>
            <div className="truncate text-[10px] text-[var(--color-text-secondary)]">
              {roles[0] ?? "viewer"}
            </div>
          </div>
          <form action="/api/auth/signout" method="post">
            <button
              type="submit"
              aria-label="Cerrar sesion"
              title="Cerrar sesion"
              className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-neutral-100)] hover:text-[var(--color-text-default)]"
            >
              <LogOut size={14} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
