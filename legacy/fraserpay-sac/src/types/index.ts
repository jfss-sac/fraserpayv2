export type UserRole = "student" | "booth" | "sac";

export interface User {
    id: string;
    studentNumber: string;
    name: string;
    email: string;
    role: UserRole;
    balance: number;
    points: number;
    favoriteProducts?: string[];
    booths?: string[];
}

export interface Booth {
    id: string;
    name: string;
    description?: string;
    pin: string;
    products: Product[];
    managers: string[]; // User IDs of managers
    totalEarnings: number;
    transactions?: Transaction[];
    createdAt?: string; // Adding the optional createdAt property to match the database
}

export interface BoothRequest {
    id: string;
    teachers: Teacher[];
    products: ProductRequest[];
    boothName: string;
    boothDescription: string;
    groupType: string;
    groupInfo: string;
    sellingDates: boolean[];
    status: string;
    additionalInformation: string;
}

export interface Product {
    id: string;
    name: string;
    price: number;
    boothId: string;
    description?: string;
    image?: string;
    salesCount?: number;
}

export interface Student {
    name: string;
    email: string;
    studentNumber: string;
}
export interface Teacher {
    name: string;
    email: string;
}

export interface ProductRequest {
    name: string;
    price: number;
}

export type PaymentMethod = "cash" | "card";

export interface Transaction {
    id: string;
    timestamp: number;
    buyerId: string;
    buyerName: string;
    sellerId?: string;
    sellerName?: string;
    boothId?: string;
    boothName?: string;
    products?: {
        productId: string;
        productName: string;
        quantity: number;
        price: number;
    }[];
    amount: number;
    type: "purchase" | "fund" | "refund" | "addPoints" | "redeemPoints";
    paymentMethod?: PaymentMethod;
    sacMemberId?: string;
    sacMemberName?: string;
}

export interface CartItem {
    productId: string;
    product: Product;
    quantity: number;
}

export interface TransactionStats {
    dailySales: {
        [date: string]: number;
    };
    topProducts: {
        productId: string;
        productName: string;
        count: number;
    }[];
    totalSales: number;
}

export interface DateRange {
    startDate?: Date;
    endDate?: Date;
}
