
import { uniqueToast } from './toastHelpers';

/**
 * Captures and handles errors in a consistent way across the application
 * @param error The error to handle
 * @param context Additional context about where the error occurred
 * @param showToast Whether to show a toast notification for this error
 * @returns The original error (for chaining)
 */
export const handleError = (
  error: unknown,
  context = 'Operation',
  showToast = true
): Error => {
  const errorObj = error instanceof Error 
    ? error 
    : new Error(typeof error === 'string' ? error : 'Unknown error');
  
  console.error(`${context} failed:`, errorObj);
  
  if (showToast) {
    uniqueToast.error(errorObj.message || `${context} failed`);
  }
  
  return errorObj;
};

/**
 * Safely executes a function and handles any errors
 * @param fn The function to execute
 * @param errorHandler Optional custom error handler
 * @returns The result of the function or undefined if an error occurred
 */
export const tryCatch = async <T>(
  fn: () => Promise<T>,
  errorHandler?: (error: Error) => void
): Promise<T | undefined> => {
  try {
    return await fn();
  } catch (error) {
    if (errorHandler) {
      errorHandler(error instanceof Error ? error : new Error(String(error)));
    } else {
      handleError(error);
    }
    return undefined;
  }
};

/**
 * Simple validation utility to ensure required data is available
 * @param value The value to check
 * @param errorMessage The error message to throw if validation fails
 * @throws Error if validation fails
 */
export const validateRequired = <T>(value: T | null | undefined, errorMessage: string): T => {
  if (value === null || value === undefined) {
    throw new Error(errorMessage);
  }
  return value;
};

/**
 * Handles Supabase specific errors with appropriate messages
 * @param error The error from Supabase
 * @param operation Description of the operation being performed
 * @returns A user-friendly error message
 */
export const getSupabaseErrorMessage = (error: any, operation = 'operation'): string => {
  if (!error) return `Unknown error during ${operation}`;
  
  // Extract error code and message
  const code = error.code || '';
  const message = error.message || '';
  
  // Handle specific Supabase error codes
  if (code === '22P02') return 'Invalid input data';
  if (code === '23505') return 'A record with this information already exists';
  if (code === '23503') return 'This operation references data that does not exist';
  if (code === '42501') return 'You do not have permission to perform this action';
  if (code === '42601') return 'SQL syntax error - please report this bug';
  if (code === '3D000') return 'Database not found - configuration issue';
  if (code === '28000' || code === '28P01') return 'Authentication failed';
  if (code === '55P03') return 'Server is too busy, please try again later';
  
  // Specific auth errors
  if (message.includes('Email not confirmed')) {
    return 'Please confirm your email address before logging in';
  }
  
  if (message.includes('Invalid login credentials')) {
    return 'Incorrect email or password';
  }
  
  // Return a sanitized version of the error message or a generic one
  return message || `Failed to ${operation}`;
};
