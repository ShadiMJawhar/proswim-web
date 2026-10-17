// Page state kept in the URL query string instead of useState, so it survives
// leaving the page (edit, another tab, back) and coming back. Same
// [value, set] shape as useState for a drop-in swap.

import { useSearchParams } from 'react-router-dom';

/** String-only variant. */
export function useUrlParam(key: string, initial: string): [string, (v: string) => void] {
  const [value, set] = useUrlState<string>(key, initial);
  return [value, set];
}

type Prim = string | number | boolean;

// `useUrlState('x', 0)` must give a number setter, not one that only accepts
// the literal 0 — TypeScript infers the literal type from the initial value,
// so widen it back to its primitive.
type Widen<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean : T;

/**
 * Typed variant: the type is inferred from `initial` (string, number or
 * boolean) and the URL value is decoded back to it, so existing handlers such
 * as `setLocationId(Number(e.target.value))` keep compiling unchanged.
 *
 * The setter accepts a value or an updater fn. Caution: react-router's
 * functional setSearchParams hands back the params captured at render, so two
 * single-key setters called in the same event handler each start from the
 * same stale copy and the second navigation drops the first key. To change
 * several keys at once use `useUrlPatch` below.
 * Note: unlike a useState setter its identity is not stable, so don't list it
 * in effect dependency arrays.
 */
export function useUrlState<T extends Prim>(
  key: string,
  initial: T,
): [Widen<T>, (v: Widen<T> | ((prev: Widen<T>) => Widen<T>)) => void] {
  type W = Widen<T>;
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);

  let value = initial as unknown as W;
  if (raw !== null) {
    if (typeof initial === 'number') {
      const n = Number(raw);
      value = (Number.isNaN(n) ? initial : n) as unknown as W;
    } else if (typeof initial === 'boolean') {
      value = (raw === 'true') as unknown as W;
    } else {
      value = raw as unknown as W;
    }
  }

  const set = (v: W | ((prev: W) => W)) => {
    const nv = typeof v === 'function' ? (v as (prev: W) => W)(value) : v;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(key, String(nv));
        return next;
      },
      { replace: true }, // don't flood history while filtering
    );
  };

  return [value, set];
}

/**
 * Multi-key setter: writes every key of `patch` in ONE navigation, so e.g.
 * `patch({ dateFrom, dateTo })` keeps both (see the caution on useUrlState).
 */
export function useUrlPatch(): (patch: Record<string, Prim>) => void {
  const [, setParams] = useSearchParams();
  return (patch) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) next.set(k, String(v));
        return next;
      },
      { replace: true },
    );
}
