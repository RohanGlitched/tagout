import type { Item, Proof, TagLevel } from "@/lib/types";
import Label from "../label/Label";
import Tag from "./Tag";
import s from "./tagged.module.css";

/**
 * A label with a tag tied to its top-right corner. The string runs from the tie point on the label to the
 * tag's grommet, which is also the tag's pivot, so the string stays attached while the tag swings.
 */
export default function Tagged({
  item,
  level,
  marks,
  swing,
  delay,
  rest,
  size = "md",
  dx = 46,
  dy = 58,
  children,
  foot,
  className = "",
}: {
  item: Item;
  level?: TagLevel;
  marks?: Partial<Record<Proof["field"], "match" | "miss" | "reading">>;
  swing?: boolean;
  delay?: number;
  rest?: number;
  size?: "sm" | "md" | "lg";
  dx?: number;
  dy?: number;
  children?: React.ReactNode;
  foot?: React.ReactNode;
  className?: string;
}) {
  // Drop the string with a little slack: a quadratic curve that sags below the straight line.
  const sag = `M0 0 Q ${dx * 0.35} ${dy * 0.85} ${dx} ${dy}`;
  return (
    <div className={`${s.tagged} ${className}`} data-size={size}>
      <Label item={item} marks={marks} />
      {level ? (
        <div className={s.hang} style={{ "--dx": `${dx}px`, "--dy": `${dy}px` } as React.CSSProperties}>
          <div className={s.tagSlot}>
            <Tag level={level} swing={swing} delay={delay} rest={rest} size={size} foot={foot}>
              {children}
            </Tag>
          </div>
          <svg className={`${s.string} ${swing ? s.stringIn : ""}`} width={Math.abs(dx) + 4} height={dy + 4} style={{ "--delay": `${delay ?? 0}ms` } as React.CSSProperties} aria-hidden="true">
            <path d={sag} transform="translate(2 2)" />
          </svg>
          <span className={s.tie} aria-hidden="true" />
        </div>
      ) : null}
    </div>
  );
}
