
import { Booth, Product, User, Transaction } from '@/types';

/**
 * Transforms a database booth object to our application Booth type
 */
export const transformDatabaseBooth = (dbBooth: any): Booth => {
  return {
    id: dbBooth.id,
    name: dbBooth.name,
    description: dbBooth.description || '',
    pin: dbBooth.pin || '',
    products: Array.isArray(dbBooth.products) 
      ? dbBooth.products.map(transformDatabaseProduct) 
      : [],
    managers: Array.isArray(dbBooth.members) ? dbBooth.members : [],
    totalEarnings: typeof dbBooth.sales === 'number' ? dbBooth.sales / 100 : 0,
    transactions: [],
    createdAt: dbBooth.created_at
  };
};

/**
 * Transforms a database product object to our application Product type
 */
export const transformDatabaseProduct = (dbProduct: any): Product => {
  return {
    id: dbProduct.id,
    name: dbProduct.name,
    price: typeof dbProduct.price === 'number' ? dbProduct.price / 100 : 0,
    boothId: dbProduct.booth_id,
    image: dbProduct.image || undefined,
    salesCount: dbProduct.sales_count || 0
  };
};

/**
 * Transforms a database user object to our application User type
 */
export const transformDatabaseUser = (dbUser: any): User => {
  return {
    id: dbUser.id,
    studentNumber: dbUser.student_number || '',
    name: dbUser.name || '',
    email: dbUser.email || '',
    role: dbUser.role || 'student',
    balance: typeof dbUser.tickets === 'number' ? dbUser.tickets / 100 : 0,
    points: typeof dbUser.points === 'number' ? dbUser.points : 0,
    favoriteProducts: dbUser.favorite_products || [],
    booths: dbUser.booth_access || []
  };
};

/**
 * Format currency amount for display
 */
export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  }).format(amount);
};

/**
 * Convert database cents to dollars
 */
export const centsToDollars = (cents: number): number => {
  return cents / 100;
};

/**
 * Convert dollars to database cents
 */
export const dollarsToCents = (dollars: number): number => {
  return Math.round(dollars * 100);
};
