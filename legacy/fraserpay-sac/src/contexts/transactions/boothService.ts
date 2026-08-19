import { firestore } from '@/integrations/firebase/client';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  addDoc, 
  updateDoc, 
  arrayUnion, 
  deleteDoc,
  arrayRemove,
  serverTimestamp
} from 'firebase/firestore';
import { Booth, Product } from '@/types';
import { toast } from 'sonner';

// Add the deleteBooth function
export const deleteBooth = async (boothId: string): Promise<boolean> => {
  try {
    const boothRef = doc(firestore, 'booths', boothId);
    
    // Get the booth data to check if it exists
    const boothSnap = await getDoc(boothRef);
    if (!boothSnap.exists()) {
      console.error('Booth not found:', boothId);
      return false;
    }
    
    // Delete the booth document
    await deleteDoc(boothRef);
    console.log('Booth deleted successfully:', boothId);
    
    return true;
  } catch (error) {
    console.error('Error deleting booth:', error);
    return false;
  }
};

// Add the deleteUser function
export const deleteUser = async (userId: string): Promise<boolean> => {
  try {
    const userRef = doc(firestore, 'users', userId);
    
    // Get the user data to check if it exists
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      console.error('User not found:', userId);
      return false;
    }
    
    // Delete the user document
    await deleteDoc(userRef);
    console.log('User deleted successfully:', userId);
    
    return true;
  } catch (error) {
    console.error('Error deleting user:', error);
    return false;
  }
};

export const createBooth = async (
  name: string, 
  description: string, 
  managerId: string,
  pin: string
): Promise<string | null> => {
  try {
    const boothsRef = collection(firestore, 'booths');
    
    // Check if a booth with the same name already exists
    const existingBoothQuery = query(boothsRef, where('name', '==', name));
    const existingBoothSnapshot = await getDocs(existingBoothQuery);
    
    if (!existingBoothSnapshot.empty) {
      toast.error('Booth name already exists. Please choose a different name.');
      return null;
    }
    
    const boothData = {
      name,
      description,
      managers: [managerId],
      products: [],
      totalEarnings: 0,
      pin: pin,
      created_at: serverTimestamp()
    };
    
    const docRef = await addDoc(boothsRef, boothData);
    
    // Update the user document to include the booth ID in the booth_access array
    const userRef = doc(firestore, 'users', managerId);
    await updateDoc(userRef, {
      booth_access: arrayUnion(docRef.id)
    });
    
    toast.success('Booth created successfully!');
    return docRef.id;
  } catch (error) {
    console.error('Error creating booth:', error);
    toast.error('Failed to create booth');
    return null;
  }
};

export const addProductToBooth = async (
  boothId: string, 
  product: { name: string; price: number; image?: string }
): Promise<boolean> => {
  try {
    const boothRef = doc(firestore, 'booths', boothId);
    
    // Check if a product with the same name already exists in the booth
    const boothSnap = await getDoc(boothRef);
    if (!boothSnap.exists()) {
      console.error('Booth not found:', boothId);
      toast.error('Booth not found');
      return false;
    }
    
    const boothData = boothSnap.data() as Booth;
    if (boothData.products && boothData.products.some(p => p.name === product.name)) {
      toast.error('Product name already exists in this booth. Please choose a different name.');
      return false;
    }
    
    const productData: Product = {
      id: `prod_${Date.now()}`,
      boothId: boothId,
      name: product.name,
      price: product.price*100,
      image: product.image,
      salesCount: 0
    };
    
    await updateDoc(boothRef, {
      products: arrayUnion(productData)
    });
    
    toast.success('Product added to booth successfully!');
    return true;
  } catch (error) {
    console.error('Error adding product to booth:', error);
    toast.error('Failed to add product to booth');
    return false;
  }
};

export const removeProductFromBooth = async (boothId: string, productId: string): Promise<boolean> => {
  try {
    const boothRef = doc(firestore, 'booths', boothId);
    
    // Get the booth data to check if the product exists
    const boothSnap = await getDoc(boothRef);
    if (!boothSnap.exists()) {
      console.error('Booth not found:', boothId);
      toast.error('Booth not found');
      return false;
    }
    
    const boothData = boothSnap.data() as Booth;
    if (!boothData.products || !boothData.products.some(p => p.id === productId)) {
      toast.error('Product not found in this booth');
      return false;
    }
    
    await updateDoc(boothRef, {
      products: arrayRemove({ id: productId })
    });
    
    toast.success('Product removed from booth successfully!');
    return true;
  } catch (error) {
    console.error('Error removing product from booth:', error);
    toast.error('Failed to remove product from booth');
    return false;
  }
};

export const getUserBooths = async (userId: string): Promise<Booth[]> => {
  try {
    const boothsRef = collection(firestore, 'booths');
    const q = query(boothsRef, where('managers', 'array-contains', userId));
    const querySnapshot = await getDocs(q);
    
    const booths: Booth[] = [];
    querySnapshot.forEach((doc) => {
      booths.push({
        id: doc.id,
        ...doc.data()
      } as Booth);
    });
    
    return booths;
  } catch (error) {
    console.error('Error fetching user booths:', error);
    toast.error('Failed to fetch user booths');
    return [];
  }
};

export const getLeaderboard = async (): Promise<{ boothId: string; boothName: string; boothDescription: string; earnings: number }[]> => {
  try {
    const boothsRef = collection(firestore, 'booths');
    const querySnapshot = await getDocs(boothsRef);
    
    const leaderboardData: { boothId: string; boothName: string; boothDescription: string; earnings: number }[] = [];
    
    querySnapshot.forEach((doc) => {
      const boothData = doc.data();
      const salesInCents = typeof boothData.sales === 'number' ? boothData.sales : 0;

      leaderboardData.push({
        boothId: doc.id,
        boothName: boothData.name,
        boothDescription: typeof boothData.description === 'string' ? boothData.description : '',
        earnings: salesInCents / 100
      });
    });
    
    leaderboardData.sort((a, b) => b.earnings - a.earnings);
    
    return leaderboardData;
  } catch (error) {
    console.error('Error fetching leaderboard data:', error);
    toast.error('Failed to fetch leaderboard data');
    return [];
  }
};
