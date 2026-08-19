
import { toast as sonnerToast } from 'sonner';
import type { ReactElement } from 'react';
import { claimToast, getToastKey, releaseToast } from './toastDeduper';

const showUniqueSonnerToast = (
  type: 'success' | 'error' | 'info' | 'warning',
  message: string,
  options?: any
) => {
  const key = getToastKey({ message });

  const id = Math.random().toString(36).substr(2, 9);
  if (!claimToast(key, id)) {
    return;
  }

  return sonnerToast[type](message, {
    ...options,
    id,
    onDismiss: () => {
      releaseToast(key, id);
      if (options?.onDismiss) {
        options.onDismiss();
      }
    }
  });
};

/**
 * Helper function to ensure no duplicate sonner toasts are displayed
 */
export const uniqueToast = {
  success: (message: string, options?: any) => {
    return showUniqueSonnerToast('success', message, options);
  },
  
  error: (message: string, options?: any) => {
    return showUniqueSonnerToast('error', message, options);
  },
  
  info: (message: string, options?: any) => {
    return showUniqueSonnerToast('info', message, options);
  },
  
  warning: (message: string, options?: any) => {
    return showUniqueSonnerToast('warning', message, options);
  },
  
  // For custom toast usage that doesn't fit the above methods
  // Update typing to match what sonner expects
  custom: (render: (id: string | number) => ReactElement, options?: any, message?: string) => {
    const key = message ? getToastKey({ message }) : undefined;

    const id = Math.random().toString(36).substr(2, 9);
    if (key && !claimToast(key, id)) {
      return;
    }
    
    return sonnerToast.custom(render, {
      ...options,
      id,
      onDismiss: () => {
        if (key) releaseToast(key, id);
        if (options?.onDismiss) {
          options.onDismiss();
        }
      }
    });
  }
};
