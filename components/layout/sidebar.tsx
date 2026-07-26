"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import hoodDeskLogo from "@/docs/images/logo.png";
import {
  LayoutDashboard,
  ArrowLeftRight,
  CandlestickChart,
  Crosshair,
  Star,
  PieChart,
  ClipboardList,
  Activity,
  Settings,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Swap", href: "/swap", icon: ArrowLeftRight },
  { label: "Terminal", href: "/trade", icon: CandlestickChart },
  { label: "Markets", href: "/markets", icon: Crosshair },
  { label: "Watchlist", href: "/watchlist", icon: Star },
  { label: "Portfolio", href: "/portfolio", icon: PieChart },
  { label: "Orders", href: "/orders", icon: ClipboardList },
  { label: "Activity", href: "/activity", icon: Activity },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <>
      <aside className="hidden w-52 shrink-0 flex-col border-r border-hood-border bg-hood-panel md:flex">
        <div className="px-4 py-4 border-b border-hood-border">
          <Link href="/" className="flex items-center gap-2.5 group">
            <Image
              src={hoodDeskLogo}
              alt="HoodDesk"
              width={32}
              height={32}
              priority
              className="w-8 h-8 rounded-xl shadow-glow transition-transform group-hover:scale-105"
            />
            <div className="flex flex-col">
              <span className="font-bold tracking-tight text-[15px] leading-tight">HoodDesk</span>
              <span className="text-[9px] text-hood-muted tracking-widest uppercase leading-tight">Robinhood Chain</span>
            </div>
          </Link>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] transition-all relative group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hood-green/30 ${
                  active
                    ? "bg-hood-green/10 text-hood-green font-semibold"
                    : "text-hood-muted hover:text-hood-text hover:bg-hood-well/70"
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-hood-green rounded-r" />
                )}
                <Icon className="w-4 h-4 shrink-0 transition-transform group-hover:scale-105" strokeWidth={1.5} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-3 border-t border-hood-border text-[10px] text-hood-muted/70 leading-relaxed">
          Real swaps on Robinhood Chain mainnet. Trades are irreversible.
        </div>
      </aside>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-50 flex h-16 overflow-x-auto border-t border-hood-border bg-hood-panel/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-w-16 flex-1 flex-col items-center justify-center gap-1 px-2 text-[10px] ${
                active ? "text-hood-green" : "text-hood-muted"
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.6} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
