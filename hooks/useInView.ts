import { useEffect, useRef, useState } from 'react';

interface UseInViewOptions {
  threshold?: number;
  root?: Element | null;
  rootMargin?: string;
}

export function useInView(options: UseInViewOptions = {}) {
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        console.log('🔭 IntersectionObserver triggered:', {
          isIntersecting: entry.isIntersecting,
          intersectionRatio: entry.intersectionRatio,
          targetElement: entry.target
        });
        setInView(entry.isIntersecting);
      },
      {
        threshold: options.threshold || 0,
        root: options.root || null,
        rootMargin: options.rootMargin || '0px'
      }
    );

    const currentRef = ref.current;
    if (currentRef) {
      console.log('👁️ Starting to observe element:', currentRef);
      observer.observe(currentRef);
    } else {
      console.log('⚠️ No element to observe yet');
    }

    return () => {
      if (currentRef) {
        console.log('🛑 Stopping observation of element');
        observer.unobserve(currentRef);
      }
    };
  }, [options.threshold, options.root, options.rootMargin]);

  return { ref, inView };
}