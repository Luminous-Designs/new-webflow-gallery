import { useEffect, useState, useCallback, useRef } from 'react';

interface UseInViewOptions {
  threshold?: number;
  root?: Element | null;
  rootMargin?: string;
  /** Trigger callback when element comes into view */
  onInView?: () => void;
  /** Only trigger once, then stop observing */
  triggerOnce?: boolean;
}

export function useInView(options: UseInViewOptions = {}) {
  const [inView, setInView] = useState(false);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const hasTriggeredRef = useRef(false);
  const onInViewRef = useRef(options.onInView);

  // Keep callback ref updated
  onInViewRef.current = options.onInView;

  // Callback ref - this is called when the element mounts/unmounts
  const ref = useCallback((node: HTMLDivElement | null) => {
    setElement(node);
  }, []);

  useEffect(() => {
    // Cleanup previous observer
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    // Don't create observer if no element
    if (!element) {
      setInView(false);
      return;
    }

    // Create new observer
    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        const isIntersecting = entry.isIntersecting;
        setInView(isIntersecting);

        // Call callback if coming into view
        if (isIntersecting && onInViewRef.current) {
          if (options.triggerOnce && hasTriggeredRef.current) {
            return;
          }
          hasTriggeredRef.current = true;
          onInViewRef.current();
        }
      },
      {
        threshold: options.threshold ?? 0,
        root: options.root ?? null,
        rootMargin: options.rootMargin ?? '0px'
      }
    );

    // Start observing
    observerRef.current.observe(element);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [element, options.threshold, options.root, options.rootMargin, options.triggerOnce]);

  // Reset trigger flag
  const resetTrigger = useCallback(() => {
    hasTriggeredRef.current = false;
  }, []);

  return { ref, inView, resetTrigger };
}