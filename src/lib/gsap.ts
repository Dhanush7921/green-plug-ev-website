import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { useLayoutEffect, type DependencyList, type RefObject } from 'react';

gsap.registerPlugin(ScrollTrigger, SplitText);
gsap.defaults({ ease: 'power3.out', duration: 0.8 });
ScrollTrigger.config({ ignoreMobileResize: true });
// Exposed for automated tests and debugging (e.g. fast-forwarding entrance timelines).
if (typeof window !== 'undefined') (window as unknown as { __gsap: typeof gsap }).__gsap = gsap;

export { gsap, ScrollTrigger, SplitText };

/**
 * Scoped GSAP setup with automatic cleanup (equivalent to @gsap/react's useGSAP).
 * Everything created inside `fn` is reverted when deps change or the component unmounts,
 * which prevents duplicated timelines and stale ScrollTriggers between pages.
 */
export function useGSAP(fn: (ctx: gsap.Context) => void | (() => void), deps: DependencyList, scope?: RefObject<Element | null>) {
  useLayoutEffect(() => {
    const ctx = gsap.context((self: gsap.Context) => fn(self), scope?.current ?? undefined);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
