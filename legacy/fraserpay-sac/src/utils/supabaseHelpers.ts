
import { uniqueToast } from './toastHelpers';

interface RetryOptions {
  maxRetries?: number;
  retryDelay?: number;
  onRetry?: (attempt: number, maxRetries: number, error: Error) => void;
  onFail?: (error: Error) => void;
}

/**
 * Execute a function with retry capability for Supabase queries
 * @param fn The async function to execute and potentially retry
 * @param options Configuration options for retries
 * @returns The result of the function or null if all retries fail
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T | null> => {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    onRetry = (attempt, max, error) => {
      console.warn(`Retry attempt ${attempt}/${max} due to: ${error.message}`);
      uniqueToast.error(`Operation failed. Retrying... (${attempt}/${max})`);
    },
    onFail = (error) => {
      console.error('All retry attempts failed:', error);
      uniqueToast.error('Operation failed after multiple attempts');
    }
  } = options;

  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      return await fn();
    } catch (error) {
      attempts++;
      
      if (attempts >= maxRetries) {
        onFail(error as Error);
        return null;
      }
      
      onRetry(attempts, maxRetries, error as Error);
      
      // Wait before next retry
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  return null;
};

/**
 * Helper function to safely access Supabase response data with proper error handling
 * @param data The data returned from a Supabase query
 * @param error The error returned from a Supabase query
 * @param fallback Optional fallback value if data is null/undefined
 * @returns Processed data with proper error handling
 */
export const processSupabaseResponse = <T>(
  data: T | null,
  error: Error | null,
  fallback: T | null = null
): { data: T | null; error: Error | null } => {
  if (error) {
    console.error('Supabase query error:', error);
    return { data: fallback, error };
  }
  
  if (!data) {
    const notFoundError = new Error('No data found');
    console.warn('Supabase query returned no data');
    return { data: fallback, error: notFoundError };
  }
  
  return { data, error: null };
};

/**
 * Validate required user authentication
 * @param user The current user object
 * @throws Error if user is not authenticated
 */
export const requireAuth = (user: any): void => {
  if (!user || !user.id) {
    console.error('Authentication required but user is not logged in');
    throw new Error('You must be logged in to perform this action');
  }
};

/**
 * Format Supabase database values to application values
 * @param value The value to format (e.g., tickets to balance)
 * @param type The type of formatting to apply
 * @returns The formatted value
 */
export const formatDatabaseValue = (
  value: number | null | undefined,
  type: 'tickets' | 'amount' = 'tickets'
): number => {
  if (value === null || value === undefined) {
    return 0;
  }
  
  // Convert cents to dollars
  return value / 100;
};

/**
 * Manage hidden booths in localStorage
 */
export const hiddenBoothsManager = {
  getHiddenBooths(): string[] {
    try {
      const storedBooths = localStorage.getItem('hiddenBooths');
      return storedBooths ? JSON.parse(storedBooths) : [];
    } catch (error) {
      console.error('Error retrieving hidden booths:', error);
      return [];
    }
  },
  
  saveHiddenBooths(boothIds: string[]): void {
    try {
      localStorage.setItem('hiddenBooths', JSON.stringify(boothIds));
    } catch (error) {
      console.error('Error saving hidden booths:', error);
    }
  },
  
  hideBooth(boothId: string): void {
    const currentHidden = this.getHiddenBooths();
    if (!currentHidden.includes(boothId)) {
      const updatedHidden = [...currentHidden, boothId];
      this.saveHiddenBooths(updatedHidden);
    }
  },
  
  showBooth(boothId: string): void {
    const currentHidden = this.getHiddenBooths();
    const updatedHidden = currentHidden.filter(id => id !== boothId);
    this.saveHiddenBooths(updatedHidden);
  },
  
  toggleBoothVisibility(boothId: string): boolean {
    const currentHidden = this.getHiddenBooths();
    const isCurrentlyHidden = currentHidden.includes(boothId);
    
    if (isCurrentlyHidden) {
      this.showBooth(boothId);
      return false; // no longer hidden
    } else {
      this.hideBooth(boothId);
      return true; // now hidden
    }
  },
  
  clearAllHiddenBooths(): void {
    localStorage.removeItem('hiddenBooths');
  }
};
