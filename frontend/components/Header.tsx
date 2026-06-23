"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { MeResponse } from "@/lib/api";
import { fetcher } from "@/lib/swr";
import { CaretDown, User, Gear, SignOut } from "@phosphor-icons/react";

export default function Header() {
  const pathname = usePathname();
  const { data: me } = useSWR<MeResponse>("/api/auth/me", fetcher);
  const role = me?.role ?? null;
  const name = me?.name ?? null;
  const color = me?.color ?? null;
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navLinkClass = (active: boolean) =>
    [
      "px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors",
      active
        ? "bg-th-muted text-th-primary"
        : "text-th-muted hover:text-th-primary hover:bg-th-subtle",
    ].join(" ");

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <header className="bg-th-surface border-b border-th px-6 md:px-10 py-4 flex-shrink-0 relative z-[9999]">
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="hover:opacity-80 transition-opacity">
            {/* Light-mode logo (dark text) / Dark-mode logo (light text) — toggled via data-theme in globals.css */}
            <Image src="/logo-light.svg" alt="Archie" width={120} height={34} className="logo-light" priority />
            <Image src="/logo-dark.svg" alt="Archie" width={120} height={34} className="logo-dark" priority />
          </Link>
          <nav className="hidden sm:flex items-center gap-1" aria-label="Primary navigation">
            <Link href="/" className={navLinkClass(pathname === "/")}>
              Projects
            </Link>
            {role === "admin" && (
              <Link href="/outcomes" className={navLinkClass(pathname === "/outcomes")}>
                Outcomes
              </Link>
            )}
          </nav>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-th-muted hover:text-th-primary transition-colors px-2 py-1 rounded-lg hover:bg-th-subtle"
            aria-expanded={open}
            aria-haspopup="true"
            aria-label="User menu"
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white uppercase"
              style={color ? { backgroundColor: color } : undefined}
            >
              {name ? name[0] : "?"}
            </div>
            <span>{name || "..."}</span>
            <CaretDown size={14} weight="bold" className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>

          {open && (
            <div className="absolute right-0 mt-2 w-48 bg-th-elevated border border-th rounded-xl shadow-lg py-1 z-[9999]" role="menu">
              <Link
                href="/profile"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-th-primary hover:bg-th-subtle transition-colors"
                role="menuitem"
              >
                <User size={16} weight="bold" className="text-th-muted" />
                Profile
              </Link>
              {role === "admin" && (
                <Link
                  href="/settings"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-th-primary hover:bg-th-subtle transition-colors"
                  role="menuitem"
                >
                  <Gear size={16} weight="bold" className="text-th-muted" />
                  Settings
                </Link>
              )}
              <div className="border-t border-th my-1" />
              <button
                onClick={() => {
                  setOpen(false);
                  handleLogout();
                }}
                className="flex items-center gap-2 w-full px-4 py-2 text-sm text-st-red hover:bg-th-subtle transition-colors"
                role="menuitem"
              >
                <SignOut size={16} weight="bold" />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
