import { useState, useCallback } from 'react';
import { Product } from '@/types';
import { firestore } from '@/integrations/firebase/client';
import { doc, getDoc, updateDoc, arrayUnion, collection, query, where, getDocs } from 'firebase/firestore';
import { toast } from 'sonner';

export interface UseProductManagementReturn {
  loadBoothProducts: (boothId: string, booths: Array<any>) => Product[];
  addProductToBooth: (boothId: string, product: Omit<Product, 'id' | 'boothId' | 'salesCount'>) => Promise<boolean>;
  removeProductFromBooth: (boothId: string, productId: string) => Promise<boolean>;
  updateBoothTotals: (boothId: string, amount: number) => Promise<boolean>;
}

export const useProductManagement = (): UseProductManagementReturn => {
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const loadBoothProducts = useCallback((boothId: string, booths: Array<any>) => {
    console.log('Loading booth products for booth:', boothId);
    const booth = booths.find(booth => booth.id === boothId);
    if (!booth) {
      console.warn('Booth not found for id:', boothId);
      return [];
    }
    
    return booth.products || [];
  }, []);

  const addProductToBoothImpl = useCallback(async (boothId: string, product: Omit<Product, 'id' | 'boothId' | 'salesCount'>) => {
    console.log('Adding product to booth:', { boothId, product });
    
    if (isProcessing) {
      console.warn('Product operation already in progress, please wait');
      toast.error('An operation is already in progress. Please wait.');
      return false;
    }
    
    try {
      setIsProcessing(true);
      
      if (!boothId) {
        console.error('Invalid booth ID');
        toast.error('Invalid booth ID');
        return false;
      }
      
      if (!product || !product.name || !product.price) {
        console.error('Invalid product data');
        toast.error('Please provide valid product information');
        return false;
      }
      
      const boothRef = doc(firestore, 'booths', boothId);
      const boothDoc = await getDoc(boothRef);
      
      if (!boothDoc.exists()) {
        console.error('Booth not found');
        toast.error('Booth not found');
        return false;
      }
      
      const productId = Date.now().toString(36) + Math.random().toString(36).substring(2);
      
      const newProduct = {
        id: productId,
        name: product.name,
        price: product.price*100,
        boothId: boothId,
        salesCount: 0,
        description: product.description || '',
        image: product.image || ''
      };
      
      const boothData = boothDoc.data();
      const currentProducts = boothData.products || [];
      
      const updatedProducts = [...currentProducts, newProduct];
      
      await updateDoc(boothRef, {
        products: updatedProducts
      });
      
      console.log('Product added successfully:', newProduct);
      toast.success('Product added successfully');
      
      return true;
    } catch (error) {
      console.error('Error adding product:', error);
      toast.error('Error adding product: ' + (error instanceof Error ? error.message : 'Unknown error'));
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing]);

  const removeProductFromBoothImpl = useCallback(async (boothId: string, productId: string) => {
    console.log('Removing product from booth:', { boothId, productId });
    
    if (isProcessing) {
      console.warn('Product operation already in progress, please wait');
      toast.error('An operation is already in progress. Please wait.');
      return false;
    }
    
    try {
      setIsProcessing(true);
      
      if (!boothId) {
        console.error('Invalid booth ID');
        toast.error('Invalid booth ID');
        return false;
      }
      
      if (!productId) {
        console.error('Invalid product ID');
        toast.error('Invalid product ID');
        return false;
      }
      
      const boothRef = doc(firestore, 'booths', boothId);
      const boothDoc = await getDoc(boothRef);
      
      if (!boothDoc.exists()) {
        console.error('Booth not found');
        toast.error('Booth not found');
        return false;
      }
      
      const boothData = boothDoc.data();
      const products = boothData.products || [];
      
      const updatedProducts = products.filter((p: any) => p.id !== productId);
      
      if (products.length === updatedProducts.length) {
        console.warn('Product not found in booth');
        toast.error('Product not found in booth');
        return false;
      }
      
      await updateDoc(boothRef, {
        products: updatedProducts
      });
      
      console.log('Product removed successfully');
      toast.success('Product removed successfully');
      
      return true;
    } catch (error) {
      console.error('Error removing product:', error);
      toast.error('Error removing product: ' + (error instanceof Error ? error.message : 'Unknown error'));
      return false;
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing]);

  const updateBoothTotals = useCallback(async (boothId: string, amount: number): Promise<boolean> => {
    console.log('Updating booth totals:', { boothId, amount });
    
    if (!boothId) {
      console.error('Invalid booth ID');
      return false;
    }
    
    try {
      const boothRef = doc(firestore, 'booths', boothId);
      const boothDoc = await getDoc(boothRef);
      
      if (!boothDoc.exists()) {
        console.error('Booth not found');
        return false;
      }
      
      const boothData = boothDoc.data();
      const currentSales = boothData.sales || 0;
      const amountInCents = Math.round(amount * 100);
      const newSales = currentSales + amountInCents;
      
      console.log('Updating booth sales:', {
        currentSales: currentSales / 100,
        amount,
        amountInCents,
        newSales: newSales / 100
      });
      
      await updateDoc(boothRef, {
        sales: newSales
      });
      
      console.log('Booth sales updated successfully:', newSales / 100);
      return true;
    } catch (error) {
      console.error('Error updating booth sales:', error);
      return false;
    }
  }, []);

  return {
    loadBoothProducts,
    addProductToBooth: addProductToBoothImpl,
    removeProductFromBooth: removeProductFromBoothImpl,
    updateBoothTotals
  };
};
