
import { Transaction, Booth, Product, CartItem, TransactionStats, DateRange } from '@/types';

export interface TransactionContextType {
  // Booth management
  booths: Booth[];
  getBoothById: (id: string) => Booth | undefined;
  loadBooths: () => void;
  loadStudentBooths: () => Booth[];
  getBoothsByUserId: (userId: string) => Booth[];
  fetchAllBooths: () => Promise<Booth[]>;
  createBooth: (name: string, description: string, userId: string, customPin?: string) => Promise<string | null>;
  deleteBooth: (boothId: string) => Promise<boolean>;
  joinBooth: (pin: string, userId: string) => Promise<boolean>;
  
  // Product management
  loadBoothProducts: (boothId: string) => Product[];
  addProductToBooth: (boothId: string, product: Omit<Product, 'id' | 'boothId' | 'salesCount'>) => Promise<boolean>;
  removeProductFromBooth: (boothId: string, productId: string) => Promise<boolean>;
  
  // Transaction management
  loadBoothTransactions: (boothId: string) => Transaction[];
  loadUserFundsTransactions: () => Transaction[];
  loadUserTransactions: (userId: string) => Transaction[];
  getSACTransactions: () => Transaction[];
  getTransactionStats: (boothId: string, dateRange: DateRange) => TransactionStats;
  getLeaderboard: () => Promise<{ boothId: string; boothName: string; boothDescription: string; earnings: number }[]>;
  recentTransactions: Transaction[];
  
  // Cart management
  cart: CartItem[];
  addToCart: (product: Product) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
  incrementQuantity: (productId: string) => void;
  decrementQuantity: (productId: string) => void;
  
  // Payment processing
  processPayment: (boothId: string) => Promise<Transaction | null>;
  processPurchase: (
    boothId: string,
    buyerId: string,
    buyerName: string,
    sellerId: string,
    sellerName: string,
    cartItems: CartItem[],
    boothName: string
  ) => Promise<{ success: boolean, transaction?: Transaction }>;
  addFunds: (userId: string, amount: number, sacMemberId: string) => Promise<{ success: boolean, updatedBalance?: number }>;
  
  // User management
  findUserByStudentNumber: (studentNumber: string) => Promise<{ id: string; name: string; balance: number } | null>;
  
  // Loading states
  isLoading: boolean;
}
