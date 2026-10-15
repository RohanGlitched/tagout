"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { WATCH_KEY } from "@/components/check/CheckRoom";

/** The watches saved in this browser, so a returning visitor can reopen theirs (and get it re-checked). */
export default function MyWatches({ className }: { className?: string }) {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    try {
      const list = JSON.parse(localStorage.getItem(WATCH_KEY) ?? "[]");
      if (Array.isArray(list)) setIds(list.filter((x): x is string => typeof x === "string" && /^[a-z0-9]{10}$/.test(x)).slice(0, 3));
    } catch {}
  }, []);
  if (!ids.length) return null;
  return (
    <p className={className}>
      {ids.length === 1 ? "You're watching a list: " : "Your watched lists: "}
      {ids.map((id, i) => (
        <span key={id}>
          {i ? ", " : ""}
          <Link href={`/watch/${id}`}>{ids.length === 1 ? "open it to check what's new" : `list ${i + 1}`}</Link>
        </span>
      ))}
      .
    </p>
  );
}
