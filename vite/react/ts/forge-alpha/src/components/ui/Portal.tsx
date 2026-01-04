import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface PortalProps {
  children: React.ReactNode;
  container?: HTMLElement;
}

export const Portal: React.FC<PortalProps> = ({
  children,
  container
}) => {
  const [mounted, setMounted] = useState(false);
  const portalRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    portalRef.current = container || document.body;
    setMounted(true);

    return () => {
      setMounted(false);
    };
  }, [container]);

  if (!mounted || !portalRef.current) {
    return null;
  }

  return createPortal(children, portalRef.current);
};
