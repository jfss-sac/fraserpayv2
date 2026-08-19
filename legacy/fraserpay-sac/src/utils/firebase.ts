
import { User, Booth, Product, Transaction } from '@/types';
import { DocumentData } from 'firebase/firestore';

// Transform Firestore document to app User type
export const transformFirebaseUser = (dbUser: DocumentData): User => {
  return {
    id: dbUser.id,
    studentNumber: dbUser.student_number,
    name: dbUser.name,
    email: dbUser.email,
    role: dbUser.role,
    balance: (dbUser.tickets || 0) / 100, // Database stores in cents
    points: dbUser.points || 0,
    favoriteProducts: [],
    booths: dbUser.booth_access || []
  };
};

// Transform app User type to Firestore document format
export const transformUserToFirebase = (user: User): DocumentData => {
  return {
    id: user.id,
    student_number: user.studentNumber,
    name: user.name,
    email: user.email,
    role: user.role,
    tickets: Math.round(user.balance * 100), // Store in cents
    points: user.points || 0,
    booth_access: user.booths || []
  };
};

// Transform Firestore document to app Booth type
export const transformFirebaseBooth = (dbBooth: DocumentData, products: DocumentData[] = []): Booth => {
  return {
    id: dbBooth.id,
    name: dbBooth.name,
    description: dbBooth.description || '',
    pin: dbBooth.pin,
    products: products.map(transformFirebaseProduct),
    managers: dbBooth.members || [],
    totalEarnings: (dbBooth.sales || 0) / 100, // Database stores in cents
    transactions: []
  };
};

// Transform Firestore document to app Product type
export const transformFirebaseProduct = (dbProduct: DocumentData): Product => {
  return {
    id: dbProduct.id,
    name: dbProduct.name,
    price: dbProduct.price / 100, // Database stores in cents
    boothId: dbProduct.booth_id,
    image: dbProduct.image,
    salesCount: 0
  };
};

// Transform Firestore document to app Transaction type
export const transformFirebaseTransaction = (
  dbTransaction: DocumentData, 
  transactionProducts: DocumentData[] = []
): Transaction => {
  let timestamp = Date.now(); // Default to current time
  
  // Try to parse the timestamp from Firestore
  if (dbTransaction.created_at) {
    try {
      if (typeof dbTransaction.created_at === 'string') {
        // Parse ISO string
        timestamp = new Date(dbTransaction.created_at).getTime();
      } else if (dbTransaction.created_at.toDate && typeof dbTransaction.created_at.toDate === 'function') {
        // Handle Firestore Timestamp object
        timestamp = dbTransaction.created_at.toDate().getTime();
      } else if (dbTransaction.created_at.seconds) {
        // Handle Firestore Timestamp fields that are serialized
        timestamp = dbTransaction.created_at.seconds * 1000;
      }
      
      // Validate timestamp - if invalid, use current time
      if (isNaN(timestamp)) {
        console.log('Invalid timestamp found, using current time');
        timestamp = Date.now();
      }
    } catch (e) {
      console.error('Error parsing timestamp:', e);
      timestamp = Date.now();
    }
  }
  
  const embeddedProducts = Array.isArray(dbTransaction.products) ? dbTransaction.products : [];
  const normalizedProducts = transactionProducts.length > 0
    ? transactionProducts
    : embeddedProducts;

  return {
    id: dbTransaction.id,
    timestamp: timestamp,
    buyerId: dbTransaction.student_id || dbTransaction.buyer_id,
    buyerName: dbTransaction.buyer_name || dbTransaction.student_name || 'Unknown',
    sellerId: dbTransaction.booth_id || undefined,
    sellerName: undefined,
    boothId: dbTransaction.booth_id || undefined,
    boothName: dbTransaction.booth_name || undefined,
    products: normalizedProducts.map((tp: any) => ({
      productId: tp.product_id || tp.productId || '',
      productName: tp.product_name || tp.productName || tp.name || 'Unknown item',
      quantity: tp.quantity || 1,
      price: tp.price // Don't divide by 100 as requested
    })),
    amount: dbTransaction.amount, // Don't divide by 100 as requested
    type: dbTransaction.type,
    paymentMethod: dbTransaction.type === 'fund' ? 'cash' : undefined,
    sacMemberId: dbTransaction.sac_member || undefined,
    sacMemberName: undefined
  };
};
