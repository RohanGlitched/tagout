import type { TagLevel } from "@/lib/types";
import s from "./tag.module.css";

export const TAG_WORDS: Record<TagLevel, string> = {
  danger: "Do not use",
  warning: "Check the label",
  inspected: "Checked",
};

/**
 * A lockout tag: card stock with a reinforced grommet and a colour-coded header, the way a technician tags a
 * machine that must not be used. Red is a matched recall, orange means the product line is recalled but this
 * one isn't confirmed either way, green means nothing was found when it was checked.
 * `swing` plays the tag being hung (once); `rest` is the angle it settles at.
 */
export default function Tag({
  level,
  children,
  foot,
  swing = false,
  delay = 0,
  rest = -3,
  size = "md",
  className = "",
}: {
  level: TagLevel;
  children?: React.ReactNode;
  foot?: React.ReactNode;
  swing?: boolean;
  delay?: number;
  rest?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <div
      className={`${s.tag} ${s[size]} ${swing ? s.swing : ""} ${className}`}
      data-level={level}
      style={{ "--rest": `${rest}deg`, "--delay": `${delay}ms` } as React.CSSProperties}
    >
      <div className={s.card}>
        <span className={s.grommet} aria-hidden="true" />
        <div className={s.head}>
          <span className={s.word}>{TAG_WORDS[level]}</span>
        </div>
        {children ? <div className={s.body}>{children}</div> : null}
        {foot ? <div className={s.foot}>{foot}</div> : null}
      </div>
    </div>
  );
}
